#import <AppKit/AppKit.h>
#import <CoreAudio/AudioHardware.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#import <Foundation/Foundation.h>
#import <signal.h>
#import <unistd.h>

static volatile sig_atomic_t shouldStopStreaming = 0;

typedef struct {
  AudioStreamBasicDescription format;
  uint8_t *scratchBuffer;
  UInt32 scratchBufferSize;
} StreamContext;

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

static NSArray<NSDictionary *> *listOutputStreams(NSError **error) {
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

    AudioObjectPropertyAddress streamsAddress = addressForScope(kAudioDevicePropertyStreams, kAudioDevicePropertyScopeOutput);
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

static BOOL streamPCM(pid_t pid, NSString *deviceUID, NSInteger streamIndex, NSError **error) {
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
  puts("  --list-output-streams");
  puts("  --create-tap --pid <pid> [--duration <seconds>] [--device-uid <uid> --stream-index <index>]");
  puts("  --stream-pcm --pid <pid> [--device-uid <uid> --stream-index <index>]");
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
      setvbuf(stdout, NULL, _IONBF, 0);
      if (!streamPCM((pid_t)pidString.intValue, deviceUID, streamIndex, &error)) {
        fprintf(stderr, "{\"event\":\"error\",\"message\":\"%s\"}\n", (error.localizedDescription ?: @"Failed to stream PCM").UTF8String);
        return 1;
      }
      return 0;
    }

    printHelp();
    return 0;
  }
}
