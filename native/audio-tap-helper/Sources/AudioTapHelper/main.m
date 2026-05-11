#import <AppKit/AppKit.h>
#import <AudioToolbox/AudioToolbox.h>
#import <AudioUnit/AudioUnit.h>
#import <CoreAudio/AudioHardware.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#import <Foundation/Foundation.h>
#import <pthread.h>
#import <signal.h>
#import <unistd.h>

static volatile sig_atomic_t shouldStopStreaming = 0;
static const UInt32 kNativeMonitorOutputBufferCount = 3;

typedef struct {
  AudioStreamBasicDescription format;
  uint8_t *scratchBuffer;
  UInt32 scratchBufferSize;
} StreamContext;

typedef struct {
  AudioStreamBasicDescription inputFormat;
  AudioStreamBasicDescription outputFormat;
  UInt32 pairStart;
  Float32 *ringBuffer;
  UInt32 ringFrames;
  UInt32 readFrame;
  UInt32 writeFrame;
  UInt32 availableFrames;
  pthread_mutex_t lock;
} NativeMonitorContext;

typedef struct {
  AudioUnit audioUnit;
  UInt32 inputChannels;
  UInt32 pairStart;
  UInt32 maxFrames;
  Float32 *inputBuffer;
} AUHALMonitorContext;

static void handleStopSignal(int signalNumber) {
  (void)signalNumber;
  shouldStopStreaming = 1;
}

static AudioObjectPropertyAddress addressFor(AudioObjectPropertySelector selector) {
  AudioObjectPropertyAddress address = {
    selector,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };
  return address;
}

static AudioObjectPropertyAddress addressForScope(AudioObjectPropertySelector selector, AudioObjectPropertyScope scope) {
  AudioObjectPropertyAddress address = {
    selector,
    scope,
    kAudioObjectPropertyElementMain
  };
  return address;
}

static NSString *statusMessage(OSStatus status) {
  return [NSString stringWithFormat:@"OSStatus %d", status];
}

static BOOL checkStatus(OSStatus status, NSString *message, NSError **error) {
  if (status == noErr) {
    return YES;
  }
  if (error) {
    *error = [NSError errorWithDomain:@"AudioTapHelper"
                                 code:status
                             userInfo:@{
                               NSLocalizedDescriptionKey: [NSString stringWithFormat:@"%@ (%@)", message, statusMessage(status)]
                             }];
  }
  return NO;
}

static BOOL writeAll(int fileDescriptor, const void *buffer, size_t byteCount) {
  const uint8_t *cursor = buffer;
  size_t remaining = byteCount;

  while (remaining > 0) {
    ssize_t written = write(fileDescriptor, cursor, remaining);
    if (written < 0) {
      return NO;
    }
    cursor += written;
    remaining -= (size_t)written;
  }

  return YES;
}

static NSString *getStringProperty(AudioObjectID objectID, AudioObjectPropertySelector selector) {
  AudioObjectPropertyAddress address = addressFor(selector);
  CFStringRef value = NULL;
  UInt32 dataSize = sizeof(CFStringRef);
  OSStatus status = AudioObjectGetPropertyData(objectID, &address, 0, NULL, &dataSize, &value);
  if (status != noErr || value == NULL) {
    return @"";
  }
  return CFBridgingRelease(value);
}

static BOOL getStreamFormat(AudioObjectID streamID, AudioStreamBasicDescription *format) {
  AudioObjectPropertyAddress address = addressFor(kAudioStreamPropertyVirtualFormat);
  UInt32 dataSize = sizeof(AudioStreamBasicDescription);
  if (AudioObjectGetPropertyData(streamID, &address, 0, NULL, &dataSize, format) == noErr) {
    return YES;
  }

  address = addressFor(kAudioStreamPropertyPhysicalFormat);
  dataSize = sizeof(AudioStreamBasicDescription);
  return AudioObjectGetPropertyData(streamID, &address, 0, NULL, &dataSize, format) == noErr;
}

static NSArray<NSNumber *> *processObjectIDs(NSError **error) {
  AudioObjectPropertyAddress address = addressFor(kAudioHardwarePropertyProcessObjectList);
  UInt32 dataSize = 0;
  if (!checkStatus(AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &dataSize),
                   @"Failed to get process object list size",
                   error)) {
    return nil;
  }

  UInt32 count = dataSize / sizeof(AudioObjectID);
  AudioObjectID *objectIDs = calloc(count, sizeof(AudioObjectID));
  if (!objectIDs) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-1
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate process object list"}];
    }
    return nil;
  }

  OSStatus status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &dataSize, objectIDs);
  if (!checkStatus(status, @"Failed to get process object list", error)) {
    free(objectIDs);
    return nil;
  }

  NSMutableArray<NSNumber *> *result = [NSMutableArray arrayWithCapacity:count];
  for (UInt32 index = 0; index < count; index++) {
    [result addObject:@(objectIDs[index])];
  }
  free(objectIDs);
  return result;
}

static BOOL getPID(AudioObjectID objectID, pid_t *pid, NSError **error) {
  AudioObjectPropertyAddress address = addressFor(kAudioProcessPropertyPID);
  UInt32 dataSize = sizeof(pid_t);
  return checkStatus(AudioObjectGetPropertyData(objectID, &address, 0, NULL, &dataSize, pid),
                     @"Failed to get process pid",
                     error);
}

static BOOL getUInt32Property(AudioObjectID objectID, AudioObjectPropertySelector selector, UInt32 *value) {
  AudioObjectPropertyAddress address = addressFor(selector);
  UInt32 dataSize = sizeof(UInt32);
  return AudioObjectGetPropertyData(objectID, &address, 0, NULL, &dataSize, value) == noErr;
}

static NSString *getBundleID(AudioObjectID objectID) {
  return getStringProperty(objectID, kAudioProcessPropertyBundleID);
}

static NSString *processName(pid_t pid, NSString *fallbackBundleID) {
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  if (app.localizedName.length > 0) {
    return app.localizedName;
  }
  if (app.bundleURL) {
    return app.bundleURL.URLByDeletingPathExtension.lastPathComponent;
  }
  if (fallbackBundleID.length > 0) {
    return fallbackBundleID;
  }
  return [NSString stringWithFormat:@"PID %d", pid];
}

static BOOL isRegularApplication(pid_t pid) {
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  return app && app.activationPolicy == NSApplicationActivationPolicyRegular;
}

static AudioObjectID translatePIDToProcessObject(pid_t pid, NSError **error) {
  AudioObjectPropertyAddress address = addressFor(kAudioHardwarePropertyTranslatePIDToProcessObject);
  AudioObjectID processObjectID = kAudioObjectUnknown;
  UInt32 dataSize = sizeof(AudioObjectID);
  UInt32 qualifierSize = sizeof(pid_t);
  if (!checkStatus(AudioObjectGetPropertyData(kAudioObjectSystemObject,
                                              &address,
                                              qualifierSize,
                                              &pid,
                                              &dataSize,
                                              &processObjectID),
                   @"Failed to translate pid to Core Audio process object",
                   error)) {
    return kAudioObjectUnknown;
  }
  if (processObjectID == kAudioObjectUnknown && error) {
    *error = [NSError errorWithDomain:@"AudioTapHelper"
                                 code:-5
                             userInfo:@{NSLocalizedDescriptionKey: @"Core Audio process object was not found for pid"}];
  }
  return processObjectID;
}

static NSArray<NSDictionary *> *listProcesses(NSError **error) {
  NSArray<NSNumber *> *objectIDs = processObjectIDs(error);
  if (!objectIDs) {
    return nil;
  }

  NSMutableArray<NSDictionary *> *processes = [NSMutableArray arrayWithCapacity:objectIDs.count];
  for (NSNumber *objectIDNumber in objectIDs) {
    AudioObjectID objectID = objectIDNumber.unsignedIntValue;
    pid_t pid = 0;
    if (!getPID(objectID, &pid, NULL)) {
      continue;
    }

    UInt32 runningOutput = 0;
    getUInt32Property(objectID, kAudioProcessPropertyIsRunningOutput, &runningOutput);

    NSString *bundleID = getBundleID(objectID);
    [processes addObject:@{
      @"objectID": @(objectID),
      @"pid": @(pid),
      @"bundleID": bundleID,
      @"name": processName(pid, bundleID),
      @"isRegularApp": @(isRegularApplication(pid)),
      @"isRunningOutput": @(runningOutput != 0)
    }];
  }

  [processes sortUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
    BOOL leftRunning = [left[@"isRunningOutput"] boolValue];
    BOOL rightRunning = [right[@"isRunningOutput"] boolValue];
    if (leftRunning != rightRunning) {
      return leftRunning ? NSOrderedAscending : NSOrderedDescending;
    }
    return [left[@"name"] localizedCaseInsensitiveCompare:right[@"name"]];
  }];

  return processes;
}

static NSArray<NSDictionary *> *listDeviceStreams(AudioObjectPropertyScope scope, NSError **error) {
  AudioObjectPropertyAddress devicesAddress = addressFor(kAudioHardwarePropertyDevices);
  UInt32 devicesDataSize = 0;
  if (!checkStatus(AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &devicesAddress, 0, NULL, &devicesDataSize),
                   @"Failed to get audio device list size",
                   error)) {
    return nil;
  }

  UInt32 deviceCount = devicesDataSize / sizeof(AudioObjectID);
  AudioObjectID *deviceIDs = calloc(deviceCount, sizeof(AudioObjectID));
  if (!deviceIDs) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-6
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate audio device list"}];
    }
    return nil;
  }

  if (!checkStatus(AudioObjectGetPropertyData(kAudioObjectSystemObject, &devicesAddress, 0, NULL, &devicesDataSize, deviceIDs),
                   @"Failed to get audio device list",
                   error)) {
    free(deviceIDs);
    return nil;
  }

  NSMutableArray<NSDictionary *> *devices = [NSMutableArray array];
  for (UInt32 deviceIndex = 0; deviceIndex < deviceCount; deviceIndex++) {
    AudioObjectID deviceID = deviceIDs[deviceIndex];
    NSString *deviceUID = getStringProperty(deviceID, kAudioDevicePropertyDeviceUID);
    NSString *deviceName = getStringProperty(deviceID, kAudioObjectPropertyName);
    if (deviceUID.length == 0) {
      continue;
    }

    AudioObjectPropertyAddress streamsAddress = addressForScope(kAudioDevicePropertyStreams, scope);
    UInt32 streamsDataSize = 0;
    if (AudioObjectGetPropertyDataSize(deviceID, &streamsAddress, 0, NULL, &streamsDataSize) != noErr || streamsDataSize == 0) {
      continue;
    }

    UInt32 streamCount = streamsDataSize / sizeof(AudioObjectID);
    AudioObjectID *streamIDs = calloc(streamCount, sizeof(AudioObjectID));
    if (!streamIDs) {
      continue;
    }

    if (AudioObjectGetPropertyData(deviceID, &streamsAddress, 0, NULL, &streamsDataSize, streamIDs) != noErr) {
      free(streamIDs);
      continue;
    }

    NSMutableArray<NSDictionary *> *streams = [NSMutableArray arrayWithCapacity:streamCount];
    for (UInt32 streamIndex = 0; streamIndex < streamCount; streamIndex++) {
      AudioStreamBasicDescription format = {0};
      BOOL hasFormat = getStreamFormat(streamIDs[streamIndex], &format);
      [streams addObject:@{
        @"streamIndex": @(streamIndex),
        @"streamObjectID": @(streamIDs[streamIndex]),
        @"sampleRate": @(hasFormat ? format.mSampleRate : 0),
        @"channels": @(hasFormat ? format.mChannelsPerFrame : 0),
        @"bitsPerChannel": @(hasFormat ? format.mBitsPerChannel : 0),
        @"formatID": @(hasFormat ? format.mFormatID : 0),
        @"formatFlags": @(hasFormat ? format.mFormatFlags : 0)
      }];
    }

    [devices addObject:@{
      @"deviceObjectID": @(deviceID),
      @"deviceUID": deviceUID,
      @"name": deviceName.length > 0 ? deviceName : deviceUID,
      @"streams": streams
    }];
    free(streamIDs);
  }

  free(deviceIDs);
  return devices;
}

static NSArray<NSDictionary *> *listOutputStreams(NSError **error) {
  return listDeviceStreams(kAudioDevicePropertyScopeOutput, error);
}

static NSArray<NSDictionary *> *listInputStreams(NSError **error) {
  return listDeviceStreams(kAudioDevicePropertyScopeInput, error);
}

static AudioObjectID findDeviceByUID(NSString *deviceUID, NSError **error) {
  if (deviceUID.length == 0) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-7
                               userInfo:@{NSLocalizedDescriptionKey: @"Input device UID was empty"}];
    }
    return kAudioObjectUnknown;
  }

  AudioObjectPropertyAddress devicesAddress = addressFor(kAudioHardwarePropertyDevices);
  UInt32 devicesDataSize = 0;
  if (!checkStatus(AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &devicesAddress, 0, NULL, &devicesDataSize),
                   @"Failed to get audio device list size",
                   error)) {
    return kAudioObjectUnknown;
  }

  UInt32 deviceCount = devicesDataSize / sizeof(AudioObjectID);
  AudioObjectID *deviceIDs = calloc(deviceCount, sizeof(AudioObjectID));
  if (!deviceIDs) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-6
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate audio device list"}];
    }
    return kAudioObjectUnknown;
  }

  AudioObjectID result = kAudioObjectUnknown;
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &devicesAddress, 0, NULL, &devicesDataSize, deviceIDs) == noErr) {
    for (UInt32 index = 0; index < deviceCount; index++) {
      NSString *candidateUID = getStringProperty(deviceIDs[index], kAudioDevicePropertyDeviceUID);
      if ([candidateUID isEqualToString:deviceUID]) {
        result = deviceIDs[index];
        break;
      }
    }
  }

  free(deviceIDs);
  if (result == kAudioObjectUnknown && error) {
    *error = [NSError errorWithDomain:@"AudioTapHelper"
                                 code:-8
                             userInfo:@{NSLocalizedDescriptionKey: @"Input device was not found by UID"}];
  }
  return result;
}

static AudioObjectID defaultOutputDevice(void) {
  AudioObjectID deviceID = kAudioObjectUnknown;
  UInt32 dataSize = sizeof(deviceID);
  AudioObjectPropertyAddress address = addressFor(kAudioHardwarePropertyDefaultOutputDevice);
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &dataSize, &deviceID) != noErr) {
    return kAudioObjectUnknown;
  }
  return deviceID;
}

static NSString *normalizedDeviceName(NSString *name) {
  NSMutableString *result = [NSMutableString string];
  NSCharacterSet *alphanumeric = [NSCharacterSet alphanumericCharacterSet];
  BOOL previousWasSpace = YES;
  NSString *lowercase = name.lowercaseString ?: @"";

  for (NSUInteger index = 0; index < lowercase.length; index++) {
    unichar character = [lowercase characterAtIndex:index];
    if ([alphanumeric characterIsMember:character]) {
      [result appendFormat:@"%C", character];
      previousWasSpace = NO;
    } else if (!previousWasSpace) {
      [result appendString:@" "];
      previousWasSpace = YES;
    }
  }

  return [result stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
}

static AudioObjectID findOutputDeviceByName(NSString *deviceName) {
  NSString *targetName = normalizedDeviceName(deviceName);
  if (targetName.length == 0 || [targetName isEqualToString:@"system default"]) {
    return defaultOutputDevice();
  }

  AudioObjectPropertyAddress devicesAddress = addressFor(kAudioHardwarePropertyDevices);
  UInt32 devicesDataSize = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &devicesAddress, 0, NULL, &devicesDataSize) != noErr) {
    return kAudioObjectUnknown;
  }

  UInt32 deviceCount = devicesDataSize / sizeof(AudioObjectID);
  AudioObjectID *deviceIDs = calloc(deviceCount, sizeof(AudioObjectID));
  if (!deviceIDs) {
    return kAudioObjectUnknown;
  }

  AudioObjectID result = kAudioObjectUnknown;
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &devicesAddress, 0, NULL, &devicesDataSize, deviceIDs) == noErr) {
    for (UInt32 index = 0; index < deviceCount; index++) {
      NSString *candidateName = normalizedDeviceName(getStringProperty(deviceIDs[index], kAudioObjectPropertyName));
      if ([candidateName isEqualToString:targetName] ||
          [candidateName containsString:targetName] ||
          [targetName containsString:candidateName]) {
        result = deviceIDs[index];
        break;
      }
    }
  }

  free(deviceIDs);
  return result;
}

static AudioObjectID createMonitorAggregateDevice(NSString *inputDeviceUID,
                                                  NSString *outputDeviceUID,
                                                  NSError **error) {
  if (inputDeviceUID.length == 0 || outputDeviceUID.length == 0) {
    return kAudioObjectUnknown;
  }

  NSString *aggregateUID = [NSString stringWithFormat:@"com.surroundstreamer.monitor.%d.%llu",
                                                      getpid(),
                                                      (unsigned long long)(NSDate.date.timeIntervalSince1970 * 1000000.0)];
  NSArray *subDevices = @[
    @{
      @(kAudioSubDeviceUIDKey): inputDeviceUID,
      @(kAudioSubDeviceDriftCompensationKey): @YES
    },
    @{
      @(kAudioSubDeviceUIDKey): outputDeviceUID,
      @(kAudioSubDeviceDriftCompensationKey): @YES
    }
  ];
  NSDictionary *description = @{
    @(kAudioAggregateDeviceNameKey): @"SurroundStreamer Native Monitor",
    @(kAudioAggregateDeviceUIDKey): aggregateUID,
    @(kAudioAggregateDeviceIsPrivateKey): @YES,
    @(kAudioAggregateDeviceSubDeviceListKey): subDevices,
    @(kAudioAggregateDeviceMasterSubDeviceKey): outputDeviceUID
  };

  AudioObjectID aggregateDeviceID = kAudioObjectUnknown;
  OSStatus status = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)description, &aggregateDeviceID);
  if (!checkStatus(status, @"Failed to create native monitor aggregate device", error)) {
    return kAudioObjectUnknown;
  }
  return aggregateDeviceID;
}

static BOOL getDeviceStreamFormat(AudioObjectID deviceID, AudioObjectPropertyScope scope, NSInteger streamIndex, AudioStreamBasicDescription *format, NSError **error) {
  AudioObjectPropertyAddress streamsAddress = addressForScope(kAudioDevicePropertyStreams, scope);
  UInt32 streamsDataSize = 0;
  if (!checkStatus(AudioObjectGetPropertyDataSize(deviceID, &streamsAddress, 0, NULL, &streamsDataSize),
                   @"Failed to get input stream list size",
                   error)) {
    return NO;
  }

  UInt32 streamCount = streamsDataSize / sizeof(AudioObjectID);
  if (streamCount == 0) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-9
                               userInfo:@{NSLocalizedDescriptionKey: @"Input device has no input streams"}];
    }
    return NO;
  }

  AudioObjectID *streamIDs = calloc(streamCount, sizeof(AudioObjectID));
  if (!streamIDs) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-6
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate input stream list"}];
    }
    return NO;
  }

  BOOL success = NO;
  if (checkStatus(AudioObjectGetPropertyData(deviceID, &streamsAddress, 0, NULL, &streamsDataSize, streamIDs),
                  @"Failed to get input stream list",
                  error)) {
    NSInteger selectedIndex = streamIndex >= 0 && streamIndex < (NSInteger)streamCount ? streamIndex : 0;
    success = getStreamFormat(streamIDs[selectedIndex], format);
    if (!success && error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-10
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to get input stream format"}];
    }
  }

  free(streamIDs);
  return success;
}

static BOOL getTapUID(AudioObjectID tapID, NSString **tapUID, NSError **error) {
  AudioObjectPropertyAddress address = addressFor(kAudioTapPropertyUID);
  CFStringRef uid = NULL;
  UInt32 dataSize = sizeof(CFStringRef);
  if (!checkStatus(AudioObjectGetPropertyData(tapID, &address, 0, NULL, &dataSize, &uid),
                   @"Failed to get tap UID",
                   error)) {
    return NO;
  }

  if (!uid) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-3
                               userInfo:@{NSLocalizedDescriptionKey: @"Tap UID was empty"}];
    }
    return NO;
  }

  *tapUID = CFBridgingRelease(uid);
  return YES;
}

static BOOL getTapFormat(AudioObjectID tapID, AudioStreamBasicDescription *format, NSError **error) {
  AudioObjectPropertyAddress address = addressFor(kAudioTapPropertyFormat);
  UInt32 dataSize = sizeof(AudioStreamBasicDescription);
  return checkStatus(AudioObjectGetPropertyData(tapID, &address, 0, NULL, &dataSize, format),
                     @"Failed to get tap format",
                     error);
}

static NSDictionary *formatDictionary(AudioStreamBasicDescription format) {
  return @{
    @"sampleRate": @(format.mSampleRate),
    @"channels": @(format.mChannelsPerFrame),
    @"bitsPerChannel": @(format.mBitsPerChannel),
    @"formatID": @(format.mFormatID),
    @"formatFlags": @(format.mFormatFlags)
  };
}

static CATapDescription *tapDescriptionForProcess(AudioObjectID processObjectID, NSString *name, NSString *deviceUID, NSInteger streamIndex) {
  CATapDescription *description = nil;
  if (deviceUID.length > 0 && streamIndex >= 0) {
    description = [[CATapDescription alloc] initWithProcesses:@[@(processObjectID)] andDeviceUID:deviceUID withStream:streamIndex];
  } else {
    description = [[CATapDescription alloc] initStereoMixdownOfProcesses:@[@(processObjectID)]];
  }

  description.name = name;
  description.privateTap = YES;
  description.muteBehavior = CATapUnmuted;
  return description;
}

static NSDictionary *createTap(pid_t pid, NSTimeInterval duration, NSString *deviceUID, NSInteger streamIndex, NSError **error) {
  if (@available(macOS 14.2, *)) {
    AudioObjectID processObjectID = translatePIDToProcessObject(pid, error);
    if (processObjectID == kAudioObjectUnknown) {
      return nil;
    }

    CATapDescription *description = tapDescriptionForProcess(processObjectID, @"SurroundStreamer App Audio Tap", deviceUID, streamIndex);

    AudioObjectID tapID = kAudioObjectUnknown;
    if (!checkStatus(AudioHardwareCreateProcessTap(description, &tapID), @"Failed to create process tap", error)) {
      return nil;
    }

    NSMutableDictionary *result = [@{
      @"tapID": @(tapID),
      @"processObjectID": @(processObjectID),
      @"pid": @(pid),
      @"mode": deviceUID.length > 0 ? @"preserve" : @"stereo"
    } mutableCopy];

    if (deviceUID.length > 0) {
      result[@"deviceUID"] = deviceUID;
      result[@"streamIndex"] = @(streamIndex);
    }

    AudioStreamBasicDescription format = {0};
    if (getTapFormat(tapID, &format, NULL)) {
      result[@"format"] = formatDictionary(format);
    }

    if (duration > 0) {
      [NSThread sleepForTimeInterval:duration];
    }

    AudioHardwareDestroyProcessTap(tapID);
    return result;
  }

  if (error) {
    *error = [NSError errorWithDomain:@"AudioTapHelper"
                                 code:-2
                             userInfo:@{NSLocalizedDescriptionKey: @"Core Audio Process Tap requires macOS 14.2 or later"}];
  }
  return nil;
}

static AudioObjectID createAggregateDevice(NSString *tapUID, NSError **error) {
  NSString *aggregateUID = [NSString stringWithFormat:@"com.surroundstreamer.tap.%@", NSUUID.UUID.UUIDString];
  NSDictionary *tapDescription = @{
    @(kAudioSubTapUIDKey): tapUID,
    @(kAudioSubTapDriftCompensationKey): @YES,
    @(kAudioSubTapDriftCompensationQualityKey): @(kAudioAggregateDriftCompensationHighQuality)
  };
  NSDictionary *aggregateDescription = @{
    @(kAudioAggregateDeviceUIDKey): aggregateUID,
    @(kAudioAggregateDeviceNameKey): @"SurroundStreamer App Audio Capture",
    @(kAudioAggregateDeviceIsPrivateKey): @YES,
    @(kAudioAggregateDeviceTapListKey): @[tapDescription]
  };

  AudioObjectID aggregateDeviceID = kAudioObjectUnknown;
  if (!checkStatus(AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)aggregateDescription,
                                                      &aggregateDeviceID),
                   @"Failed to create aggregate device for process tap",
                   error)) {
    return kAudioObjectUnknown;
  }

  return aggregateDeviceID;
}

static UInt32 clampBufferFrameSize(AudioObjectID deviceID, UInt32 requestedFrames) {
  if (requestedFrames == 0) {
    return 0;
  }

  AudioValueRange frameRange = {0};
  UInt32 dataSize = sizeof(frameRange);
  AudioObjectPropertyAddress rangeAddress = addressFor(kAudioDevicePropertyBufferFrameSizeRange);
  OSStatus status = AudioObjectGetPropertyData(deviceID, &rangeAddress, 0, NULL, &dataSize, &frameRange);
  if (status != noErr || frameRange.mMinimum <= 0 || frameRange.mMaximum <= 0) {
    return requestedFrames;
  }

  Float64 clamped = requestedFrames;
  if (clamped < frameRange.mMinimum) {
    clamped = frameRange.mMinimum;
  }
  if (clamped > frameRange.mMaximum) {
    clamped = frameRange.mMaximum;
  }
  return (UInt32)clamped;
}

static void requestDeviceBufferFrameSize(AudioObjectID deviceID, UInt32 requestedFrames) {
  UInt32 targetFrames = clampBufferFrameSize(deviceID, requestedFrames);
  if (targetFrames == 0) {
    return;
  }

  AudioObjectPropertyAddress bufferAddress = addressFor(kAudioDevicePropertyBufferFrameSize);
  UInt32 dataSize = sizeof(targetFrames);
  OSStatus status = AudioObjectSetPropertyData(deviceID, &bufferAddress, 0, NULL, dataSize, &targetFrames);
  if (status == noErr) {
    fprintf(stderr,
            "{\"event\":\"status\",\"message\":\"Requested Core Audio IO buffer: %u frames\"}\n",
            targetFrames);
  } else {
    fprintf(stderr,
            "{\"event\":\"status\",\"message\":\"Could not set Core Audio IO buffer to %u frames (%s)\"}\n",
            targetFrames,
            statusMessage(status).UTF8String);
  }
  fflush(stderr);
}

static OSStatus captureIOProc(AudioObjectID inDevice,
                              const AudioTimeStamp *inNow,
                              const AudioBufferList *inInputData,
                              const AudioTimeStamp *inInputTime,
                              AudioBufferList *outOutputData,
                              const AudioTimeStamp *inOutputTime,
                              void *inClientData) {
  (void)inDevice;
  (void)inNow;
  (void)inInputTime;
  (void)outOutputData;
  (void)inOutputTime;

  StreamContext *context = (StreamContext *)inClientData;
  if (!context || !inInputData || inInputData->mNumberBuffers == 0) {
    return noErr;
  }

  if (inInputData->mNumberBuffers == 1) {
    const AudioBuffer buffer = inInputData->mBuffers[0];
    if (buffer.mData && buffer.mDataByteSize > 0) {
      writeAll(STDOUT_FILENO, buffer.mData, buffer.mDataByteSize);
    }
    return noErr;
  }

  UInt32 channels = context->format.mChannelsPerFrame;
  UInt32 bytesPerSample = context->format.mBitsPerChannel / 8;
  if (channels == 0 || bytesPerSample == 0) {
    return noErr;
  }

  const AudioBuffer firstBuffer = inInputData->mBuffers[0];
  if (!firstBuffer.mData || firstBuffer.mDataByteSize == 0) {
    return noErr;
  }

  UInt32 frames = firstBuffer.mDataByteSize / bytesPerSample;
  UInt32 requiredBytes = frames * channels * bytesPerSample;
  if (requiredBytes > context->scratchBufferSize || !context->scratchBuffer) {
    return noErr;
  }

  for (UInt32 frame = 0; frame < frames; frame++) {
    for (UInt32 channel = 0; channel < channels; channel++) {
      uint8_t *target = context->scratchBuffer + ((frame * channels + channel) * bytesPerSample);
      if (channel >= inInputData->mNumberBuffers || !inInputData->mBuffers[channel].mData) {
        memset(target, 0, bytesPerSample);
        continue;
      }

      const uint8_t *source = (const uint8_t *)inInputData->mBuffers[channel].mData;
      memcpy(target, source + (frame * bytesPerSample), bytesPerSample);
    }
  }

  writeAll(STDOUT_FILENO, context->scratchBuffer, requiredBytes);
  return noErr;
}

static Float32 monitorSampleAt(const AudioBufferList *bufferList,
                               AudioStreamBasicDescription format,
                               UInt32 frame,
                               UInt32 channel) {
  UInt32 channels = MAX(1, format.mChannelsPerFrame);
  if (!bufferList || channel >= channels || bufferList->mNumberBuffers == 0) {
    return 0.0f;
  }

  if (bufferList->mNumberBuffers == 1) {
    const AudioBuffer buffer = bufferList->mBuffers[0];
    if (!buffer.mData) {
      return 0.0f;
    }
    const Float32 *samples = (const Float32 *)buffer.mData;
    return samples[(frame * channels) + channel];
  }

  if (channel >= bufferList->mNumberBuffers || !bufferList->mBuffers[channel].mData) {
    return 0.0f;
  }
  const Float32 *samples = (const Float32 *)bufferList->mBuffers[channel].mData;
  return samples[frame];
}

static void nativeMonitorPushFrame(NativeMonitorContext *context, Float32 left, Float32 right) {
  if (!context || !context->ringBuffer || context->ringFrames == 0) {
    return;
  }

  pthread_mutex_lock(&context->lock);
  context->ringBuffer[(context->writeFrame * 2) + 0] = left;
  context->ringBuffer[(context->writeFrame * 2) + 1] = right;
  context->writeFrame = (context->writeFrame + 1) % context->ringFrames;
  if (context->availableFrames < context->ringFrames) {
    context->availableFrames += 1;
  } else {
    context->readFrame = (context->readFrame + 1) % context->ringFrames;
  }
  pthread_mutex_unlock(&context->lock);
}

static OSStatus nativeMonitorInputIOProc(AudioObjectID inDevice,
                                         const AudioTimeStamp *inNow,
                                         const AudioBufferList *inInputData,
                                         const AudioTimeStamp *inInputTime,
                                         AudioBufferList *outOutputData,
                                         const AudioTimeStamp *inOutputTime,
                                         void *inClientData) {
  (void)inDevice;
  (void)inNow;
  (void)inInputTime;
  (void)outOutputData;
  (void)inOutputTime;

  NativeMonitorContext *context = (NativeMonitorContext *)inClientData;
  if (!context || !inInputData || inInputData->mNumberBuffers == 0) {
    return noErr;
  }

  UInt32 channels = MAX(1, context->inputFormat.mChannelsPerFrame);
  UInt32 bytesPerSample = context->inputFormat.mBitsPerChannel / 8;
  if (bytesPerSample != sizeof(Float32)) {
    return noErr;
  }

  UInt32 frames = 0;
  if (inInputData->mNumberBuffers == 1) {
    frames = inInputData->mBuffers[0].mDataByteSize / (bytesPerSample * channels);
  } else {
    frames = inInputData->mBuffers[0].mDataByteSize / bytesPerSample;
  }

  UInt32 leftChannel = MIN(context->pairStart, channels - 1);
  UInt32 rightChannel = MIN(leftChannel + 1, channels - 1);
  for (UInt32 frame = 0; frame < frames; frame++) {
    nativeMonitorPushFrame(context,
                           monitorSampleAt(inInputData, context->inputFormat, frame, leftChannel),
                           monitorSampleAt(inInputData, context->inputFormat, frame, rightChannel));
  }

  return noErr;
}

static void nativeMonitorOutputCallback(void *inUserData,
                                        AudioQueueRef inAQ,
                                        AudioQueueBufferRef inBuffer) {
  (void)inAQ;
  NativeMonitorContext *context = (NativeMonitorContext *)inUserData;
  UInt32 frameBytes = context ? context->outputFormat.mBytesPerFrame : sizeof(Float32) * 2;
  UInt32 frames = inBuffer->mAudioDataBytesCapacity / frameBytes;
  Float32 *output = (Float32 *)inBuffer->mAudioData;

  if (!context || !context->ringBuffer) {
    memset(output, 0, frames * frameBytes);
    inBuffer->mAudioDataByteSize = frames * frameBytes;
    AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, NULL);
    return;
  }

  pthread_mutex_lock(&context->lock);
  for (UInt32 frame = 0; frame < frames; frame++) {
    if (context->availableFrames > 0) {
      output[(frame * 2) + 0] = context->ringBuffer[(context->readFrame * 2) + 0];
      output[(frame * 2) + 1] = context->ringBuffer[(context->readFrame * 2) + 1];
      context->readFrame = (context->readFrame + 1) % context->ringFrames;
      context->availableFrames -= 1;
    } else {
      output[(frame * 2) + 0] = 0.0f;
      output[(frame * 2) + 1] = 0.0f;
    }
  }
  pthread_mutex_unlock(&context->lock);

  inBuffer->mAudioDataByteSize = frames * frameBytes;
  AudioQueueEnqueueBuffer(inAQ, inBuffer, 0, NULL);
}

static AudioStreamBasicDescription packedFloatFormat(Float64 sampleRate, UInt32 channels) {
  AudioStreamBasicDescription format = {0};
  format.mSampleRate = sampleRate;
  format.mFormatID = kAudioFormatLinearPCM;
  format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
  format.mBytesPerPacket = sizeof(Float32) * channels;
  format.mFramesPerPacket = 1;
  format.mBytesPerFrame = sizeof(Float32) * channels;
  format.mChannelsPerFrame = channels;
  format.mBitsPerChannel = 32;
  return format;
}

static void clearAudioBufferList(AudioBufferList *ioData, UInt32 frameCount) {
  if (!ioData) {
    return;
  }
  for (UInt32 bufferIndex = 0; bufferIndex < ioData->mNumberBuffers; bufferIndex++) {
    AudioBuffer *buffer = &ioData->mBuffers[bufferIndex];
    if (buffer->mData && buffer->mDataByteSize > 0) {
      memset(buffer->mData, 0, buffer->mDataByteSize);
    } else if (buffer->mData && buffer->mNumberChannels > 0) {
      memset(buffer->mData, 0, frameCount * buffer->mNumberChannels * sizeof(Float32));
    }
  }
}

static void writeStereoOutput(AudioBufferList *ioData,
                              UInt32 frameCount,
                              const Float32 *input,
                              UInt32 inputChannels,
                              UInt32 pairStart) {
  if (!ioData || !input || inputChannels == 0) {
    clearAudioBufferList(ioData, frameCount);
    return;
  }

  UInt32 leftChannel = MIN(pairStart, inputChannels - 1);
  UInt32 rightChannel = MIN(leftChannel + 1, inputChannels - 1);
  if (ioData->mNumberBuffers == 1) {
    AudioBuffer *buffer = &ioData->mBuffers[0];
    Float32 *output = (Float32 *)buffer->mData;
    UInt32 outputChannels = MAX(1, buffer->mNumberChannels);
    if (!output) {
      return;
    }
    for (UInt32 frame = 0; frame < frameCount; frame++) {
      output[(frame * outputChannels) + 0] = input[(frame * inputChannels) + leftChannel];
      if (outputChannels > 1) {
        output[(frame * outputChannels) + 1] = input[(frame * inputChannels) + rightChannel];
      }
      for (UInt32 channel = 2; channel < outputChannels; channel++) {
        output[(frame * outputChannels) + channel] = 0.0f;
      }
    }
    return;
  }

  for (UInt32 bufferIndex = 0; bufferIndex < ioData->mNumberBuffers; bufferIndex++) {
    AudioBuffer *buffer = &ioData->mBuffers[bufferIndex];
    Float32 *output = (Float32 *)buffer->mData;
    if (!output) {
      continue;
    }
    UInt32 sourceChannel = bufferIndex == 0 ? leftChannel : rightChannel;
    for (UInt32 frame = 0; frame < frameCount; frame++) {
      output[frame] = bufferIndex < 2 ? input[(frame * inputChannels) + sourceChannel] : 0.0f;
    }
  }
}

static OSStatus auhalMonitorRenderCallback(void *inRefCon,
                                           AudioUnitRenderActionFlags *ioActionFlags,
                                           const AudioTimeStamp *inTimeStamp,
                                           UInt32 inBusNumber,
                                           UInt32 inNumberFrames,
                                           AudioBufferList *ioData) {
  (void)inBusNumber;
  AUHALMonitorContext *context = (AUHALMonitorContext *)inRefCon;
  if (!context || !context->audioUnit || !context->inputBuffer || inNumberFrames > context->maxFrames) {
    clearAudioBufferList(ioData, inNumberFrames);
    return noErr;
  }

  AudioBufferList inputList = {0};
  inputList.mNumberBuffers = 1;
  inputList.mBuffers[0].mNumberChannels = context->inputChannels;
  inputList.mBuffers[0].mDataByteSize = inNumberFrames * context->inputChannels * sizeof(Float32);
  inputList.mBuffers[0].mData = context->inputBuffer;

  OSStatus status = AudioUnitRender(context->audioUnit,
                                    ioActionFlags,
                                    inTimeStamp,
                                    1,
                                    inNumberFrames,
                                    &inputList);
  if (status != noErr) {
    clearAudioBufferList(ioData, inNumberFrames);
    return noErr;
  }

  writeStereoOutput(ioData,
                    inNumberFrames,
                    context->inputBuffer,
                    context->inputChannels,
                    context->pairStart);
  return noErr;
}

static BOOL streamPCM(pid_t pid, NSString *deviceUID, NSInteger streamIndex, UInt32 requestedBufferFrames, NSError **error) {
  if (@available(macOS 14.2, *)) {
    AudioObjectID processObjectID = translatePIDToProcessObject(pid, error);
    if (processObjectID == kAudioObjectUnknown) {
      return NO;
    }

    CATapDescription *description = tapDescriptionForProcess(processObjectID, @"SurroundStreamer App Audio Stream", deviceUID, streamIndex);

    AudioObjectID tapID = kAudioObjectUnknown;
    if (!checkStatus(AudioHardwareCreateProcessTap(description, &tapID), @"Failed to create process tap", error)) {
      return NO;
    }

    NSString *tapUID = nil;
    AudioStreamBasicDescription format = {0};
    AudioObjectID aggregateDeviceID = kAudioObjectUnknown;
    AudioDeviceIOProcID ioProcID = NULL;
    StreamContext context = {0};
    BOOL success = NO;

    if (!getTapUID(tapID, &tapUID, error)) {
      goto cleanup;
    }

    if (!getTapFormat(tapID, &format, error)) {
      goto cleanup;
    }

    aggregateDeviceID = createAggregateDevice(tapUID, error);
    if (aggregateDeviceID == kAudioObjectUnknown) {
      goto cleanup;
    }

    requestDeviceBufferFrameSize(aggregateDeviceID, requestedBufferFrames);

    context.format = format;
    context.scratchBufferSize = 1024 * 1024;
    context.scratchBuffer = calloc(context.scratchBufferSize, 1);
    if (!context.scratchBuffer) {
      if (error) {
        *error = [NSError errorWithDomain:@"AudioTapHelper"
                                     code:-4
                                 userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate PCM scratch buffer"}];
      }
      goto cleanup;
    }

    if (!checkStatus(AudioDeviceCreateIOProcID(aggregateDeviceID, captureIOProc, &context, &ioProcID),
                     @"Failed to create aggregate device IO proc",
                     error)) {
      goto cleanup;
    }

    fprintf(stderr,
            "{\"event\":\"format\",\"sampleRate\":%.0f,\"channels\":%u,\"bitsPerChannel\":%u,\"mode\":\"%s\"}\n",
            format.mSampleRate,
            format.mChannelsPerFrame,
            format.mBitsPerChannel,
            deviceUID.length > 0 ? "preserve" : "stereo");
    fflush(stderr);

    if (!checkStatus(AudioDeviceStart(aggregateDeviceID, ioProcID),
                     @"Failed to start aggregate device IO",
                     error)) {
      goto cleanup;
    }

    while (!shouldStopStreaming) {
      [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    }

    success = YES;

  cleanup:
    if (ioProcID) {
      AudioDeviceStop(aggregateDeviceID, ioProcID);
      AudioDeviceDestroyIOProcID(aggregateDeviceID, ioProcID);
    }
    if (aggregateDeviceID != kAudioObjectUnknown) {
      AudioHardwareDestroyAggregateDevice(aggregateDeviceID);
    }
    if (tapID != kAudioObjectUnknown) {
      AudioHardwareDestroyProcessTap(tapID);
    }
    free(context.scratchBuffer);
    return success;
  }

  if (error) {
    *error = [NSError errorWithDomain:@"AudioTapHelper"
                                 code:-2
                             userInfo:@{NSLocalizedDescriptionKey: @"Core Audio Process Tap requires macOS 14.2 or later"}];
  }
  return NO;
}

static BOOL streamInputDevicePCM(NSString *deviceUID, NSInteger streamIndex, NSError **error) {
  AudioObjectID deviceID = findDeviceByUID(deviceUID, error);
  if (deviceID == kAudioObjectUnknown) {
    return NO;
  }

  AudioStreamBasicDescription format = {0};
  AudioDeviceIOProcID ioProcID = NULL;
  StreamContext context = {0};
  BOOL success = NO;

  if (!getDeviceStreamFormat(deviceID, kAudioDevicePropertyScopeInput, streamIndex, &format, error)) {
    goto cleanup;
  }

  if (format.mFormatID != kAudioFormatLinearPCM ||
      !(format.mFormatFlags & kAudioFormatFlagIsFloat) ||
      format.mBitsPerChannel != 32) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-11
                               userInfo:@{NSLocalizedDescriptionKey: @"Input device virtual format is not 32-bit float PCM"}];
    }
    goto cleanup;
  }

  context.format = format;
  context.scratchBufferSize = 1024 * 1024;
  context.scratchBuffer = calloc(context.scratchBufferSize, 1);
  if (!context.scratchBuffer) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-4
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate PCM scratch buffer"}];
    }
    goto cleanup;
  }

  if (!checkStatus(AudioDeviceCreateIOProcID(deviceID, captureIOProc, &context, &ioProcID),
                   @"Failed to create input device IO proc",
                   error)) {
    goto cleanup;
  }

  fprintf(stderr,
          "{\"event\":\"format\",\"sampleRate\":%.0f,\"channels\":%u,\"bitsPerChannel\":%u,\"mode\":\"input-device\"}\n",
          format.mSampleRate,
          format.mChannelsPerFrame,
          format.mBitsPerChannel);
  fflush(stderr);

  if (!checkStatus(AudioDeviceStart(deviceID, ioProcID),
                   @"Failed to start input device IO",
                   error)) {
    goto cleanup;
  }

  while (!shouldStopStreaming) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  }

  success = YES;

cleanup:
  if (ioProcID) {
    AudioDeviceStop(deviceID, ioProcID);
    AudioDeviceDestroyIOProcID(deviceID, ioProcID);
  }
  free(context.scratchBuffer);
  return success;
}

static BOOL monitorInputDevice(NSString *inputDeviceUID,
                               NSInteger inputStreamIndex,
                               NSString *outputDeviceName,
                               UInt32 pairStart,
                               UInt32 requestedBufferFrames,
                               NSError **error) {
  AudioObjectID inputDeviceID = findDeviceByUID(inputDeviceUID, error);
  if (inputDeviceID == kAudioObjectUnknown) {
    return NO;
  }

  AudioObjectID outputDeviceID = findOutputDeviceByName(outputDeviceName);
  if (outputDeviceID == kAudioObjectUnknown) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-12
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to resolve monitor output device"}];
    }
    return NO;
  }

  AudioStreamBasicDescription inputFormat = {0};
  AudioStreamBasicDescription outputFormat = {0};
  AudioDeviceIOProcID inputIOProcID = NULL;
  AudioQueueRef outputQueue = NULL;
  AudioQueueBufferRef outputBuffers[kNativeMonitorOutputBufferCount] = {NULL};
  NativeMonitorContext context = {0};
  NSString *outputDeviceUID = nil;
  BOOL success = NO;

  if (!getDeviceStreamFormat(inputDeviceID, kAudioDevicePropertyScopeInput, inputStreamIndex, &inputFormat, error)) {
    goto cleanup;
  }

  if (inputFormat.mFormatID != kAudioFormatLinearPCM ||
      !(inputFormat.mFormatFlags & kAudioFormatFlagIsFloat) ||
      inputFormat.mBitsPerChannel != 32) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-11
                               userInfo:@{NSLocalizedDescriptionKey: @"Input device virtual format is not 32-bit float PCM"}];
    }
    goto cleanup;
  }

  UInt32 bufferFrames = requestedBufferFrames > 0 ? requestedBufferFrames : 64;
  requestDeviceBufferFrameSize(inputDeviceID, bufferFrames);
  requestDeviceBufferFrameSize(outputDeviceID, bufferFrames);

  outputFormat.mSampleRate = inputFormat.mSampleRate;
  outputFormat.mFormatID = kAudioFormatLinearPCM;
  outputFormat.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
  outputFormat.mBytesPerPacket = sizeof(Float32) * 2;
  outputFormat.mFramesPerPacket = 1;
  outputFormat.mBytesPerFrame = sizeof(Float32) * 2;
  outputFormat.mChannelsPerFrame = 2;
  outputFormat.mBitsPerChannel = 32;

  context.inputFormat = inputFormat;
  context.outputFormat = outputFormat;
  context.pairStart = pairStart;
  context.ringFrames = MAX(bufferFrames * 4, 256);
  context.ringBuffer = calloc(context.ringFrames * 2, sizeof(Float32));
  pthread_mutex_init(&context.lock, NULL);
  if (!context.ringBuffer) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-4
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate native monitor ring buffer"}];
    }
    goto cleanup;
  }

  if (!checkStatus(AudioQueueNewOutput(&outputFormat,
                                       nativeMonitorOutputCallback,
                                       &context,
                                       CFRunLoopGetCurrent(),
                                       kCFRunLoopCommonModes,
                                       0,
                                       &outputQueue),
                   @"Failed to create native monitor output queue",
                   error)) {
    goto cleanup;
  }

  outputDeviceUID = getStringProperty(outputDeviceID, kAudioDevicePropertyDeviceUID);
  if (outputDeviceUID.length > 0) {
    CFStringRef outputUIDRef = (__bridge CFStringRef)outputDeviceUID;
    AudioQueueSetProperty(outputQueue, kAudioQueueProperty_CurrentDevice, &outputUIDRef, sizeof(outputUIDRef));
  }

  UInt32 outputBufferBytes = bufferFrames * outputFormat.mBytesPerFrame;
  for (UInt32 index = 0; index < kNativeMonitorOutputBufferCount; index++) {
    if (!checkStatus(AudioQueueAllocateBuffer(outputQueue, outputBufferBytes, &outputBuffers[index]),
                     @"Failed to allocate native monitor output buffer",
                     error)) {
      goto cleanup;
    }
    memset(outputBuffers[index]->mAudioData, 0, outputBufferBytes);
    outputBuffers[index]->mAudioDataByteSize = outputBufferBytes;
    if (!checkStatus(AudioQueueEnqueueBuffer(outputQueue, outputBuffers[index], 0, NULL),
                     @"Failed to prime native monitor output buffer",
                     error)) {
      goto cleanup;
    }
  }

  if (!checkStatus(AudioDeviceCreateIOProcID(inputDeviceID, nativeMonitorInputIOProc, &context, &inputIOProcID),
                   @"Failed to create native monitor input IO proc",
                   error)) {
    goto cleanup;
  }

  fprintf(stderr,
          "{\"event\":\"format\",\"sampleRate\":%.0f,\"channels\":2,\"bitsPerChannel\":32,\"mode\":\"native-input-monitor\"}\n",
          outputFormat.mSampleRate);
  fflush(stderr);

  if (!checkStatus(AudioQueueStart(outputQueue, NULL), @"Failed to start native monitor output queue", error)) {
    goto cleanup;
  }

  if (!checkStatus(AudioDeviceStart(inputDeviceID, inputIOProcID), @"Failed to start native monitor input IO", error)) {
    goto cleanup;
  }

  while (!shouldStopStreaming) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  }

  success = YES;

cleanup:
  if (inputIOProcID) {
    AudioDeviceStop(inputDeviceID, inputIOProcID);
    AudioDeviceDestroyIOProcID(inputDeviceID, inputIOProcID);
  }
  if (outputQueue) {
    AudioQueueStop(outputQueue, true);
    AudioQueueDispose(outputQueue, true);
  }
  free(context.ringBuffer);
  pthread_mutex_destroy(&context.lock);
  return success;
}

static BOOL monitorInputDeviceAUHAL(NSString *inputDeviceUID,
                                    NSInteger inputStreamIndex,
                                    NSString *outputDeviceName,
                                    UInt32 pairStart,
                                    UInt32 requestedBufferFrames,
                                    NSError **error) {
  AudioObjectID inputDeviceID = findDeviceByUID(inputDeviceUID, error);
  if (inputDeviceID == kAudioObjectUnknown) {
    return NO;
  }

  AudioObjectID outputDeviceID = findOutputDeviceByName(outputDeviceName);
  if (outputDeviceID == kAudioObjectUnknown) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-12
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to resolve monitor output device"}];
    }
    return NO;
  }

  NSString *outputDeviceUID = getStringProperty(outputDeviceID, kAudioDevicePropertyDeviceUID);
  AudioObjectID monitorDeviceID = inputDeviceID;
  AudioObjectID aggregateDeviceID = kAudioObjectUnknown;
  AudioStreamBasicDescription inputFormat = {0};
  AudioComponentInstance audioUnit = NULL;
  AUHALMonitorContext context = {0};
  BOOL success = NO;

  if (!getDeviceStreamFormat(inputDeviceID, kAudioDevicePropertyScopeInput, inputStreamIndex, &inputFormat, error)) {
    goto cleanup;
  }

  if (inputFormat.mFormatID != kAudioFormatLinearPCM ||
      !(inputFormat.mFormatFlags & kAudioFormatFlagIsFloat) ||
      inputFormat.mBitsPerChannel != 32) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-11
                               userInfo:@{NSLocalizedDescriptionKey: @"Input device virtual format is not 32-bit float PCM"}];
    }
    goto cleanup;
  }

  if (![inputDeviceUID isEqualToString:outputDeviceUID]) {
    aggregateDeviceID = createMonitorAggregateDevice(inputDeviceUID, outputDeviceUID, error);
    if (aggregateDeviceID == kAudioObjectUnknown) {
      goto cleanup;
    }
    monitorDeviceID = aggregateDeviceID;
  }

  UInt32 bufferFrames = requestedBufferFrames > 0 ? requestedBufferFrames : 64;
  requestDeviceBufferFrameSize(inputDeviceID, bufferFrames);
  requestDeviceBufferFrameSize(outputDeviceID, bufferFrames);
  requestDeviceBufferFrameSize(monitorDeviceID, bufferFrames);

  AudioComponentDescription description = {0};
  description.componentType = kAudioUnitType_Output;
  description.componentSubType = kAudioUnitSubType_HALOutput;
  description.componentManufacturer = kAudioUnitManufacturer_Apple;
  AudioComponent component = AudioComponentFindNext(NULL, &description);
  if (!component) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-13
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to find AUHAL component"}];
    }
    goto cleanup;
  }

  if (!checkStatus(AudioComponentInstanceNew(component, &audioUnit),
                   @"Failed to create AUHAL instance",
                   error)) {
    goto cleanup;
  }

  UInt32 enableIO = 1;
  if (!checkStatus(AudioUnitSetProperty(audioUnit,
                                        kAudioOutputUnitProperty_EnableIO,
                                        kAudioUnitScope_Input,
                                        1,
                                        &enableIO,
                                        sizeof(enableIO)),
                   @"Failed to enable AUHAL input",
                   error)) {
    goto cleanup;
  }
  if (!checkStatus(AudioUnitSetProperty(audioUnit,
                                        kAudioOutputUnitProperty_EnableIO,
                                        kAudioUnitScope_Output,
                                        0,
                                        &enableIO,
                                        sizeof(enableIO)),
                   @"Failed to enable AUHAL output",
                   error)) {
    goto cleanup;
  }
  if (!checkStatus(AudioUnitSetProperty(audioUnit,
                                        kAudioOutputUnitProperty_CurrentDevice,
                                        kAudioUnitScope_Global,
                                        0,
                                        &monitorDeviceID,
                                        sizeof(monitorDeviceID)),
                   @"Failed to set AUHAL current device",
                   error)) {
    goto cleanup;
  }

  AudioStreamBasicDescription inputClientFormat = packedFloatFormat(inputFormat.mSampleRate, inputFormat.mChannelsPerFrame);
  AudioStreamBasicDescription outputClientFormat = packedFloatFormat(inputFormat.mSampleRate, 2);
  if (!checkStatus(AudioUnitSetProperty(audioUnit,
                                        kAudioUnitProperty_StreamFormat,
                                        kAudioUnitScope_Output,
                                        1,
                                        &inputClientFormat,
                                        sizeof(inputClientFormat)),
                   @"Failed to set AUHAL input client format",
                   error)) {
    goto cleanup;
  }
  if (!checkStatus(AudioUnitSetProperty(audioUnit,
                                        kAudioUnitProperty_StreamFormat,
                                        kAudioUnitScope_Input,
                                        0,
                                        &outputClientFormat,
                                        sizeof(outputClientFormat)),
                   @"Failed to set AUHAL output client format",
                   error)) {
    goto cleanup;
  }

  context.audioUnit = audioUnit;
  context.inputChannels = inputFormat.mChannelsPerFrame;
  context.pairStart = pairStart;
  context.maxFrames = 16384;
  context.inputBuffer = calloc(context.maxFrames * context.inputChannels, sizeof(Float32));
  if (!context.inputBuffer) {
    if (error) {
      *error = [NSError errorWithDomain:@"AudioTapHelper"
                                   code:-4
                               userInfo:@{NSLocalizedDescriptionKey: @"Failed to allocate AUHAL monitor input buffer"}];
    }
    goto cleanup;
  }

  AURenderCallbackStruct callback = {0};
  callback.inputProc = auhalMonitorRenderCallback;
  callback.inputProcRefCon = &context;
  if (!checkStatus(AudioUnitSetProperty(audioUnit,
                                        kAudioUnitProperty_SetRenderCallback,
                                        kAudioUnitScope_Input,
                                        0,
                                        &callback,
                                        sizeof(callback)),
                   @"Failed to set AUHAL render callback",
                   error)) {
    goto cleanup;
  }

  if (!checkStatus(AudioUnitInitialize(audioUnit), @"Failed to initialize AUHAL monitor", error)) {
    goto cleanup;
  }

  fprintf(stderr,
          "{\"event\":\"format\",\"sampleRate\":%.0f,\"channels\":2,\"bitsPerChannel\":32,\"mode\":\"auhal-input-monitor\"}\n",
          inputFormat.mSampleRate);
  fflush(stderr);

  if (!checkStatus(AudioOutputUnitStart(audioUnit), @"Failed to start AUHAL monitor", error)) {
    goto cleanup;
  }

  while (!shouldStopStreaming) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  }

  success = YES;

cleanup:
  if (audioUnit) {
    AudioOutputUnitStop(audioUnit);
    AudioUnitUninitialize(audioUnit);
    AudioComponentInstanceDispose(audioUnit);
  }
  if (aggregateDeviceID != kAudioObjectUnknown) {
    AudioHardwareDestroyAggregateDevice(aggregateDeviceID);
  }
  free(context.inputBuffer);
  return success;
}

static void printJSON(id object) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
  if (data) {
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
  }
}

static NSString *argumentValue(NSArray<NSString *> *arguments, NSString *option) {
  NSUInteger index = [arguments indexOfObject:option];
  if (index == NSNotFound || index + 1 >= arguments.count) {
    return nil;
  }
  return arguments[index + 1];
}

static NSInteger argumentIntegerValue(NSArray<NSString *> *arguments, NSString *option, NSInteger defaultValue) {
  NSString *value = argumentValue(arguments, option);
  if (!value) {
    return defaultValue;
  }
  return value.integerValue;
}

static void printHelp(void) {
  puts("AudioTapHelper");
  puts("");
  puts("Commands:");
  puts("  --list-processes");
  puts("  --list-input-streams");
  puts("  --list-output-streams");
  puts("  --create-tap --pid <pid> [--duration <seconds>] [--device-uid <uid> --stream-index <index>]");
  puts("  --stream-pcm --pid <pid> [--device-uid <uid> --stream-index <index>]");
  puts("  --stream-input-device --device-uid <uid> [--stream-index <index>]");
  puts("  --monitor-input-device --device-uid <uid> [--stream-index <index>] [--output-device-name <name>] [--pair-start <index>] [--buffer-frames <frames>]");
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSArray<NSString *> *arguments = [[NSProcessInfo processInfo].arguments subarrayWithRange:NSMakeRange(1, MAX(0, argc - 1))];
    NSError *error = nil;
    signal(SIGINT, handleStopSignal);
    signal(SIGTERM, handleStopSignal);
    signal(SIGPIPE, SIG_IGN);

    if ([arguments containsObject:@"--list-processes"]) {
      NSArray<NSDictionary *> *processes = listProcesses(&error);
      if (!processes) {
        printJSON(@{@"error": error.localizedDescription ?: @"Failed to list processes"});
        return 1;
      }
      printJSON(@{@"processes": processes});
      return 0;
    }

    if ([arguments containsObject:@"--list-output-streams"]) {
      NSArray<NSDictionary *> *devices = listOutputStreams(&error);
      if (!devices) {
        printJSON(@{@"error": error.localizedDescription ?: @"Failed to list output streams"});
        return 1;
      }
      printJSON(@{@"devices": devices});
      return 0;
    }

    if ([arguments containsObject:@"--list-input-streams"]) {
      NSArray<NSDictionary *> *devices = listInputStreams(&error);
      if (!devices) {
        printJSON(@{@"error": error.localizedDescription ?: @"Failed to list input streams"});
        return 1;
      }
      printJSON(@{@"devices": devices});
      return 0;
    }

    if ([arguments containsObject:@"--create-tap"]) {
      NSString *pidString = argumentValue(arguments, @"--pid");
      if (!pidString) {
        printJSON(@{@"error": @"--create-tap requires --pid <pid>"});
        return 1;
      }
      NSTimeInterval duration = argumentValue(arguments, @"--duration").doubleValue;
      NSString *deviceUID = argumentValue(arguments, @"--device-uid");
      NSInteger streamIndex = argumentIntegerValue(arguments, @"--stream-index", -1);
      NSDictionary *tap = createTap((pid_t)pidString.intValue, duration, deviceUID, streamIndex, &error);
      if (!tap) {
        printJSON(@{@"error": error.localizedDescription ?: @"Failed to create tap"});
        return 1;
      }
      printJSON(tap);
      return 0;
    }

    if ([arguments containsObject:@"--stream-pcm"]) {
      NSString *pidString = argumentValue(arguments, @"--pid");
      if (!pidString) {
        printJSON(@{@"error": @"--stream-pcm requires --pid <pid>"});
        return 1;
      }

      NSString *deviceUID = argumentValue(arguments, @"--device-uid");
      NSInteger streamIndex = argumentIntegerValue(arguments, @"--stream-index", -1);
      NSInteger bufferFrames = argumentIntegerValue(arguments, @"--buffer-frames", 0);
      setvbuf(stdout, NULL, _IONBF, 0);
      if (!streamPCM((pid_t)pidString.intValue, deviceUID, streamIndex, (UInt32)MAX(0, bufferFrames), &error)) {
        fprintf(stderr, "{\"event\":\"error\",\"message\":\"%s\"}\n", (error.localizedDescription ?: @"Failed to stream PCM").UTF8String);
        return 1;
      }
      return 0;
    }

    if ([arguments containsObject:@"--stream-input-device"]) {
      NSString *deviceUID = argumentValue(arguments, @"--device-uid");
      if (!deviceUID) {
        printJSON(@{@"error": @"--stream-input-device requires --device-uid <uid>"});
        return 1;
      }

      NSInteger streamIndex = argumentIntegerValue(arguments, @"--stream-index", -1);
      setvbuf(stdout, NULL, _IONBF, 0);
      if (!streamInputDevicePCM(deviceUID, streamIndex, &error)) {
        fprintf(stderr, "{\"event\":\"error\",\"message\":\"%s\"}\n", (error.localizedDescription ?: @"Failed to stream input device PCM").UTF8String);
        return 1;
      }
      return 0;
    }

    if ([arguments containsObject:@"--monitor-input-device"]) {
      NSString *deviceUID = argumentValue(arguments, @"--device-uid");
      if (!deviceUID) {
        printJSON(@{@"error": @"--monitor-input-device requires --device-uid <uid>"});
        return 1;
      }

      NSInteger streamIndex = argumentIntegerValue(arguments, @"--stream-index", -1);
      NSString *outputDeviceName = argumentValue(arguments, @"--output-device-name") ?: @"";
      NSInteger pairStart = argumentIntegerValue(arguments, @"--pair-start", 0);
      NSInteger bufferFrames = argumentIntegerValue(arguments, @"--buffer-frames", 64);
      if (!monitorInputDevice(deviceUID,
                              streamIndex,
                              outputDeviceName,
                              (UInt32)MAX(0, pairStart),
                              (UInt32)MAX(16, bufferFrames),
                              &error)) {
        fprintf(stderr, "{\"event\":\"error\",\"message\":\"%s\"}\n", (error.localizedDescription ?: @"Failed to monitor input device").UTF8String);
        return 1;
      }
      return 0;
    }

    printHelp();
    return 0;
  }
}
