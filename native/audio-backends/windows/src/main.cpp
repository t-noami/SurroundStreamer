#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <audioclient.h>
#if __has_include(<audioclientactivationparams.h>)
#include <audioclientactivationparams.h>
#endif
#include <avrt.h>
#include <fcntl.h>
#include <io.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <objbase.h>
#include <propidl.h>
#include <functiondiscoverykeys_devpkey.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <string>
#include <set>
#include <vector>

#ifndef VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
typedef enum AUDIOCLIENT_ACTIVATION_TYPE {
  AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT,
  AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
} AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum PROCESS_LOOPBACK_MODE {
  PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
  PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
} PROCESS_LOOPBACK_MODE;
typedef struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
  DWORD TargetProcessId;
  PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct AUDIOCLIENT_ACTIVATION_PARAMS {
  AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
  union {
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
  };
} AUDIOCLIENT_ACTIVATION_PARAMS;
#endif

template <typename T>
class ComPtr {
 public:
  ComPtr() = default;
  ~ComPtr() { reset(); }
  T* get() const { return ptr_; }
  T** put() {
    reset();
    return &ptr_;
  }
  T* operator->() const { return ptr_; }
  T* detach() {
    T* value = ptr_;
    ptr_ = nullptr;
    return value;
  }
  void reset(T* value = nullptr) {
    if (ptr_) ptr_->Release();
    ptr_ = value;
  }

 private:
  T* ptr_ = nullptr;
};

class ActivationHandler final : public IActivateAudioInterfaceCompletionHandler,
                                public IAgileObject {
 public:
  ActivationHandler() { event_ = CreateEventW(nullptr, TRUE, FALSE, nullptr); }
  ~ActivationHandler() {
    if (event_) CloseHandle(event_);
  }

  HRESULT wait(DWORD timeoutMs = 10000) {
    return WaitForSingleObject(event_, timeoutMs) == WAIT_OBJECT_0 ? result_ : HRESULT_FROM_WIN32(ERROR_TIMEOUT);
  }

  IAudioClient* detachAudioClient() { return audioClient_.detach(); }

  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs_); }

  ULONG STDMETHODCALLTYPE Release() override {
    ULONG refs = InterlockedDecrement(&refs_);
    if (refs == 0) delete this;
    return refs;
  }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** object) override {
    if (!object) return E_POINTER;
    *object = nullptr;
    if (riid == __uuidof(IUnknown) ||
        riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *object = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *object = static_cast<IAgileObject*>(this);
    } else {
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }

  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    ComPtr<IUnknown> activated;
    HRESULT activateResult = E_FAIL;
    result_ = operation->GetActivateResult(&activateResult, activated.put());
    if (SUCCEEDED(result_)) result_ = activateResult;
    if (SUCCEEDED(result_)) result_ = activated->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(audioClient_.put()));
    SetEvent(event_);
    return S_OK;
  }

 private:
  volatile LONG refs_ = 1;
  HANDLE event_ = nullptr;
  HRESULT result_ = E_FAIL;
  ComPtr<IAudioClient> audioClient_;
};

typedef long ASIOBool;
typedef long ASIOError;
typedef double ASIOSampleRate;
typedef long ASIOSamples;

struct ASIOTimeStamp {
  ASIOSamples hi;
  ASIOSamples lo;
};

struct ASIOTimeInfo {
  double speed;
  ASIOTimeStamp systemTime;
  ASIOTimeStamp samplePosition;
  ASIOSampleRate sampleRate;
  long flags;
  char reserved[12];
};

struct ASIOTimeCode {
  double speed;
  ASIOTimeStamp timeCodeSamples;
  long flags;
  char future[64];
};

struct ASIOTime {
  long reserved[4];
  ASIOTimeInfo timeInfo;
  ASIOTimeCode timeCode;
};

typedef long ASIOMessageSelector;
typedef long ASIOChannel;

struct ASIOCallbacks {
  void (*bufferSwitch)(long doubleBufferIndex, ASIOBool directProcess);
  void (*sampleRateDidChange)(ASIOSampleRate sRate);
  long (*asioMessage)(ASIOMessageSelector selector, long value, void* message, double* opt);
  ASIOTime* (*bufferSwitchTimeInfo)(ASIOTime* params, long doubleBufferIndex, ASIOBool directProcess);
};

struct ASIOBufferInfo {
  ASIOBool isInput;
  ASIOChannel channelNum;
  void* buffers[2];
};

struct ASIOChannelInfo {
  long channel;
  ASIOBool isInput;
  ASIOBool isActive;
  long channelGroup;
  long type;
  char name[32];
};

enum AsioSampleType {
  ASIOSTInt16LSB = 16,
  ASIOSTInt24LSB = 17,
  ASIOSTInt32LSB = 18,
  ASIOSTFloat32LSB = 19,
  ASIOSTFloat64LSB = 20,
  ASIOSTInt32LSB16 = 24,
  ASIOSTInt32LSB18 = 25,
  ASIOSTInt32LSB20 = 26,
  ASIOSTInt32LSB24 = 27
};

class IASIO : public IUnknown {
 public:
  virtual ASIOBool init(void* sysHandle) = 0;
  virtual void getDriverName(char* name) = 0;
  virtual long getDriverVersion() = 0;
  virtual void getErrorMessage(char* string) = 0;
  virtual ASIOError start() = 0;
  virtual ASIOError stop() = 0;
  virtual ASIOError getChannels(long* numInputChannels, long* numOutputChannels) = 0;
  virtual ASIOError getLatencies(long* inputLatency, long* outputLatency) = 0;
  virtual ASIOError getBufferSize(long* minSize, long* maxSize, long* preferredSize, long* granularity) = 0;
  virtual ASIOError canSampleRate(ASIOSampleRate sampleRate) = 0;
  virtual ASIOError getSampleRate(ASIOSampleRate* sampleRate) = 0;
  virtual ASIOError setSampleRate(ASIOSampleRate sampleRate) = 0;
  virtual ASIOError getClockSources(void* clocks, long* numSources) = 0;
  virtual ASIOError setClockSource(long reference) = 0;
  virtual ASIOError getSamplePosition(ASIOTimeStamp* samplePosition, ASIOTimeStamp* timeStamp) = 0;
  virtual ASIOError getChannelInfo(ASIOChannelInfo* info) = 0;
  virtual ASIOError createBuffers(ASIOBufferInfo* bufferInfos, long numChannels, long bufferSize, ASIOCallbacks* callbacks) = 0;
  virtual ASIOError disposeBuffers() = 0;
  virtual ASIOError controlPanel() = 0;
  virtual ASIOError future(long selector, void* opt) = 0;
  virtual ASIOError outputReady() = 0;
};

static void writeJsonEvent(const char* event, const char* message) {
  fprintf(stderr, "{\"event\":\"%s\",\"message\":\"%s\"}\n", event, message);
  fflush(stderr);
}

static void writeError(const std::string& message) {
  writeJsonEvent("error", message.c_str());
}

static std::string hrMessage(const char* label, HRESULT hr) {
  char buffer[128];
  snprintf(buffer, sizeof(buffer), "%s failed: 0x%08lx", label, static_cast<unsigned long>(hr));
  return std::string(buffer);
}

static std::string wideToUtf8(const wchar_t* value) {
  if (!value) return "";
  int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 1) return "";
  std::string result(static_cast<size_t>(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), size, nullptr, nullptr);
  return result;
}

static std::string jsonEscape(const std::string& value) {
  std::string escaped;
  escaped.reserve(value.size() + 8);
  for (unsigned char ch : value) {
    switch (ch) {
      case '\\':
        escaped += "\\\\";
        break;
      case '"':
        escaped += "\\\"";
        break;
      case '\b':
        escaped += "\\b";
        break;
      case '\f':
        escaped += "\\f";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        if (ch < 0x20) {
          char buffer[8];
          snprintf(buffer, sizeof(buffer), "\\u%04x", ch);
          escaped += buffer;
        } else {
          escaped += static_cast<char>(ch);
        }
    }
  }
  return escaped;
}

static bool hasArg(int argc, wchar_t** argv, const wchar_t* name) {
  for (int i = 1; i < argc; ++i) {
    if (wcscmp(argv[i], name) == 0) return true;
  }
  return false;
}

static std::wstring argValue(int argc, wchar_t** argv, const wchar_t* name, const wchar_t* fallback = L"") {
  for (int i = 1; i + 1 < argc; ++i) {
    if (wcscmp(argv[i], name) == 0) return argv[i + 1];
  }
  return fallback;
}

static int intArg(int argc, wchar_t** argv, const wchar_t* name, int fallback) {
  std::wstring value = argValue(argc, argv, name, L"");
  if (value.empty()) return fallback;
  return _wtoi(value.c_str());
}

static DWORD channelMaskFor(int channels) {
  switch (channels) {
    case 1:
      return SPEAKER_FRONT_CENTER;
    case 2:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    case 3:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_LOW_FREQUENCY;
    case 4:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT;
    case 5:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER |
             SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT;
    case 6:
      return KSAUDIO_SPEAKER_5POINT1;
    case 7:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER |
             SPEAKER_LOW_FREQUENCY | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT |
             SPEAKER_BACK_CENTER;
    case 8:
      return KSAUDIO_SPEAKER_7POINT1_SURROUND;
    default:
      return 0;
  }
}

static WAVEFORMATEXTENSIBLE makeFloatFormat(int sampleRate, int channels) {
  WAVEFORMATEXTENSIBLE format = {};
  format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  format.Format.nChannels = static_cast<WORD>(channels);
  format.Format.nSamplesPerSec = static_cast<DWORD>(sampleRate);
  format.Format.wBitsPerSample = 32;
  format.Format.nBlockAlign = static_cast<WORD>(channels * sizeof(float));
  format.Format.nAvgBytesPerSec = format.Format.nSamplesPerSec * format.Format.nBlockAlign;
  format.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  format.Samples.wValidBitsPerSample = 32;
  format.dwChannelMask = channelMaskFor(channels);
  format.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
  return format;
}

static std::string layoutName(int channels) {
  switch (channels) {
    case 1:
      return "mono";
    case 2:
      return "stereo";
    case 3:
      return "2.1";
    case 4:
      return "quad";
    case 5:
      return "5.0";
    case 6:
      return "5.1";
    case 7:
      return "6.1";
    case 8:
      return "7.1";
    default:
      return std::to_string(channels) + "c";
  }
}

static void writeFormatEvent(int sampleRate, int channels) {
  fprintf(stderr,
          "{\"event\":\"format\",\"sampleRate\":%d,\"channels\":%d,\"layout\":\"%s\",\"bitsPerChannel\":32}\n",
          sampleRate,
          channels,
          layoutName(channels).c_str());
  fflush(stderr);
}

static bool writeAll(const void* data, size_t bytes) {
  const uint8_t* cursor = static_cast<const uint8_t*>(data);
  while (bytes > 0) {
    size_t written = fwrite(cursor, 1, bytes, stdout);
    if (written == 0) return false;
    cursor += written;
    bytes -= written;
  }
  fflush(stdout);
  return true;
}

static bool isFloatFormat(const WAVEFORMATEX* format) {
  if (!format) return false;
  if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) return true;
  if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) return false;
  const WAVEFORMATEXTENSIBLE* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
  return IsEqualGUID(extensible->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
}

static bool isPcmFormat(const WAVEFORMATEX* format) {
  if (!format) return false;
  if (format->wFormatTag == WAVE_FORMAT_PCM) return true;
  if (format->wFormatTag != WAVE_FORMAT_EXTENSIBLE) return false;
  const WAVEFORMATEXTENSIBLE* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
  return IsEqualGUID(extensible->SubFormat, KSDATAFORMAT_SUBTYPE_PCM);
}

static int validBitsPerSample(const WAVEFORMATEX* format) {
  if (!format) return 0;
  if (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
    const WAVEFORMATEXTENSIBLE* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
    if (extensible->Samples.wValidBitsPerSample > 0) {
      return extensible->Samples.wValidBitsPerSample;
    }
  }
  return format->wBitsPerSample;
}

static float pcmSampleToFloat(const uint8_t* sample, int bytesPerSample, int bitsPerSample) {
  if (bytesPerSample == 1) {
    return (static_cast<int>(*sample) - 128) / 128.0f;
  }

  if (bytesPerSample == 2) {
    int16_t value = static_cast<int16_t>(sample[0] | (sample[1] << 8));
    return std::max(-1.0f, value / 32768.0f);
  }

  if (bytesPerSample == 3 || bitsPerSample == 24) {
    int32_t value = sample[0] | (sample[1] << 8) | (sample[2] << 16);
    if (value & 0x800000) value |= ~0xFFFFFF;
    return std::max(-1.0f, value / 8388608.0f);
  }

  if (bytesPerSample >= 4) {
    int32_t value = static_cast<int32_t>(
      sample[0] | (sample[1] << 8) | (sample[2] << 16) | (sample[3] << 24));
    return std::max(-1.0f, value / 2147483648.0f);
  }

  return 0.0f;
}

static bool writeFloatFrames(const BYTE* data, UINT32 frames, DWORD flags, const WAVEFORMATEX* format) {
  const int channels = format->nChannels;
  const size_t sampleCount = static_cast<size_t>(frames) * channels;
  static std::vector<float> converted;

  if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
    converted.assign(sampleCount, 0.0f);
    return writeAll(converted.data(), converted.size() * sizeof(float));
  }

  if (isFloatFormat(format) && format->wBitsPerSample == 32 &&
      format->nBlockAlign == channels * sizeof(float)) {
    return writeAll(data, sampleCount * sizeof(float));
  }

  if (!isPcmFormat(format)) {
    return false;
  }

  const int bytesPerSample = std::max<int>(1, format->nBlockAlign / std::max<int>(1, channels));
  const int bitsPerSample = validBitsPerSample(format);
  converted.resize(sampleCount);
  for (UINT32 frame = 0; frame < frames; ++frame) {
    const uint8_t* frameData = data + (static_cast<size_t>(frame) * format->nBlockAlign);
    for (int channel = 0; channel < channels; ++channel) {
      converted[(static_cast<size_t>(frame) * channels) + channel] =
        pcmSampleToFloat(frameData + (static_cast<size_t>(channel) * bytesPerSample),
                         bytesPerSample,
                         bitsPerSample);
    }
  }

  return writeAll(converted.data(), converted.size() * sizeof(float));
}

static int runCaptureLoop(IAudioClient* audioClient, IAudioCaptureClient* captureClient, const WAVEFORMATEX* format) {
  writeFormatEvent(static_cast<int>(format->nSamplesPerSec), static_cast<int>(format->nChannels));

  HRESULT hr = audioClient->Start();
  if (FAILED(hr)) {
    writeError(hrMessage("IAudioClient::Start", hr));
    return 1;
  }

  DWORD mmcssTaskIndex = 0;
  HANDLE mmcssTask = AvSetMmThreadCharacteristicsW(L"Audio", &mmcssTaskIndex);

  while (true) {
    UINT32 packetFrames = 0;
    hr = captureClient->GetNextPacketSize(&packetFrames);
    if (FAILED(hr)) {
      writeError(hrMessage("IAudioCaptureClient::GetNextPacketSize", hr));
      break;
    }

    if (packetFrames == 0) {
      Sleep(5);
      continue;
    }

    BYTE* data = nullptr;
    UINT32 frames = 0;
    DWORD flags = 0;
    hr = captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
    if (FAILED(hr)) {
      writeError(hrMessage("IAudioCaptureClient::GetBuffer", hr));
      break;
    }

    bool wrote = writeFloatFrames(data, frames, flags, format);
    captureClient->ReleaseBuffer(frames);
    if (!wrote) break;
  }

  audioClient->Stop();
  if (mmcssTask) AvRevertMmThreadCharacteristics(mmcssTask);
  return 1;
}

static HRESULT getMixFormat(IAudioClient* audioClient, WAVEFORMATEX** format) {
  *format = nullptr;
  return audioClient->GetMixFormat(format);
}

static int listAudioEndpoints(EDataFlow dataFlow, const char* jsonKey) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    writeError(hrMessage("CoInitializeEx", hr));
    return 1;
  }

  ComPtr<IMMDeviceEnumerator> enumerator;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator),
                        nullptr,
                        CLSCTX_ALL,
                        __uuidof(IMMDeviceEnumerator),
                        reinterpret_cast<void**>(enumerator.put()));
  if (FAILED(hr)) {
    writeError(hrMessage("CoCreateInstance(MMDeviceEnumerator)", hr));
    CoUninitialize();
    return 1;
  }

  ComPtr<IMMDeviceCollection> collection;
  hr = enumerator->EnumAudioEndpoints(dataFlow, DEVICE_STATE_ACTIVE, collection.put());
  if (FAILED(hr)) {
    writeError(hrMessage("EnumAudioEndpoints", hr));
    CoUninitialize();
    return 1;
  }

  UINT count = 0;
  collection->GetCount(&count);
  fprintf(stdout, "{\"%s\":[", jsonKey);
  bool first = true;
  for (UINT index = 0; index < count; ++index) {
    ComPtr<IMMDevice> device;
    if (FAILED(collection->Item(index, device.put()))) continue;

    LPWSTR id = nullptr;
    if (FAILED(device->GetId(&id))) continue;

    std::string name = dataFlow == eCapture ? "Windows Audio Input" : "Windows Audio Output";
    ComPtr<IPropertyStore> properties;
    if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, properties.put()))) {
      PROPVARIANT friendlyName;
      PropVariantInit(&friendlyName);
      if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &friendlyName)) &&
          friendlyName.vt == VT_LPWSTR) {
        name = wideToUtf8(friendlyName.pwszVal);
      }
      PropVariantClear(&friendlyName);
    }

    int sampleRate = 48000;
    int channels = 2;
    int bitsPerChannel = 32;
    ComPtr<IAudioClient> audioClient;
    if (SUCCEEDED(device->Activate(__uuidof(IAudioClient),
                                   CLSCTX_ALL,
                                   nullptr,
                                   reinterpret_cast<void**>(audioClient.put())))) {
      WAVEFORMATEX* mixFormat = nullptr;
      if (SUCCEEDED(getMixFormat(audioClient.get(), &mixFormat)) && mixFormat) {
        sampleRate = static_cast<int>(mixFormat->nSamplesPerSec);
        channels = static_cast<int>(mixFormat->nChannels);
        bitsPerChannel = validBitsPerSample(mixFormat);
        CoTaskMemFree(mixFormat);
      }
    }

    if (!first) fprintf(stdout, ",");
    first = false;
    fprintf(stdout,
            "{\"index\":\"%u\",\"name\":\"%s\",\"deviceUID\":\"%s\",\"sampleRate\":%d,\"channels\":%d,\"bitsPerChannel\":%d}",
            index,
            jsonEscape(name).c_str(),
            jsonEscape(wideToUtf8(id)).c_str(),
            sampleRate,
            channels,
            bitsPerChannel);
    CoTaskMemFree(id);
  }
  fprintf(stdout, "]}\n");
  CoUninitialize();
  return 0;
}

static int listInputDevices() {
  return listAudioEndpoints(eCapture, "devices");
}

static int listOutputDevices() {
  return listAudioEndpoints(eRender, "devices");
}

static std::wstring registryStringValue(HKEY key, const wchar_t* name) {
  DWORD type = 0;
  DWORD bytes = 0;
  if (RegQueryValueExW(key, name, nullptr, &type, nullptr, &bytes) != ERROR_SUCCESS ||
      (type != REG_SZ && type != REG_EXPAND_SZ) || bytes < sizeof(wchar_t)) {
    return L"";
  }

  std::vector<wchar_t> buffer(bytes / sizeof(wchar_t) + 1, L'\0');
  if (RegQueryValueExW(key,
                       name,
                       nullptr,
                       nullptr,
                       reinterpret_cast<BYTE*>(buffer.data()),
                       &bytes) != ERROR_SUCCESS) {
    return L"";
  }
  return buffer.data();
}

static void collectAsioRegistryDevices(HKEY root,
                                       REGSAM view,
                                       std::vector<std::pair<std::wstring, std::wstring>>& devices,
                                       std::set<std::wstring>& seenClsids) {
  HKEY asioKey = nullptr;
  if (RegOpenKeyExW(root, L"SOFTWARE\\ASIO", 0, KEY_READ | view, &asioKey) != ERROR_SUCCESS) {
    return;
  }

  DWORD index = 0;
  wchar_t subkeyName[256];
  DWORD subkeyNameChars = 256;
  while (RegEnumKeyExW(asioKey, index, subkeyName, &subkeyNameChars, nullptr, nullptr, nullptr, nullptr) == ERROR_SUCCESS) {
    HKEY driverKey = nullptr;
    if (RegOpenKeyExW(asioKey, subkeyName, 0, KEY_READ | view, &driverKey) == ERROR_SUCCESS) {
      std::wstring clsid = registryStringValue(driverKey, L"CLSID");
      if (!clsid.empty() && seenClsids.insert(clsid).second) {
        devices.push_back({subkeyName, clsid});
      }
      RegCloseKey(driverKey);
    }
    ++index;
    subkeyNameChars = 256;
  }

  RegCloseKey(asioKey);
}

static bool probeAsioDevice(const std::wstring& fallbackName,
                            const std::wstring& clsidValue,
                            std::string& outputJson) {
  CLSID clsid = {};
  HRESULT hr = CLSIDFromString(clsidValue.c_str(), &clsid);
  if (FAILED(hr)) return false;

  IASIO* driver = nullptr;
  hr = CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER, clsid, reinterpret_cast<void**>(&driver));

  char driverName[128] = {};
  long inputChannels = 0;
  long outputChannels = 0;
  bool initialized = false;
  ASIOError channelResult = -1;
  ASIOSampleRate sampleRate = 0;
  ASIOError rateResult = -1;
  long minBuffer = 0;
  long maxBuffer = 0;
  long preferredBuffer = 0;
  long granularity = 0;
  ASIOError bufferResult = -1;
  HRESULT createResult = hr;

  if (driver) {
    initialized = driver->init(GetDesktopWindow()) != 0;
    driver->getDriverName(driverName);
    channelResult = initialized ? driver->getChannels(&inputChannels, &outputChannels) : -1;
    rateResult = initialized ? driver->getSampleRate(&sampleRate) : -1;
    bufferResult =
      initialized ? driver->getBufferSize(&minBuffer, &maxBuffer, &preferredBuffer, &granularity) : -1;
    driver->Release();
  }

  std::string fallbackNameUtf8 = wideToUtf8(fallbackName.c_str());
  std::string clsidUtf8 = wideToUtf8(clsidValue.c_str());
  std::string name = driverName[0] ? std::string(driverName) : fallbackNameUtf8;
  char buffer[2048];
  snprintf(buffer,
           sizeof(buffer),
           "{\"name\":\"%s\",\"deviceUID\":\"asio:%s\",\"driverName\":\"%s\",\"clsid\":\"%s\",\"available\":%s,\"inputChannels\":%ld,\"outputChannels\":%ld,\"sampleRate\":%.0f,\"preferredBufferSize\":%ld,\"createResult\":\"0x%08lx\",\"channelStatus\":%ld,\"sampleRateStatus\":%ld,\"bufferStatus\":%ld}",
           jsonEscape(fallbackNameUtf8).c_str(),
           jsonEscape(clsidUtf8).c_str(),
           jsonEscape(name).c_str(),
           jsonEscape(clsidUtf8).c_str(),
           initialized ? "true" : "false",
           channelResult == 0 ? inputChannels : 0,
           channelResult == 0 ? outputChannels : 0,
           rateResult == 0 ? sampleRate : 0.0,
           bufferResult == 0 ? preferredBuffer : 0,
           static_cast<unsigned long>(createResult),
           channelResult,
           rateResult,
           bufferResult);
  outputJson = buffer;
  return true;
}

static int listAsioDevices(bool probeDrivers) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(hr)) {
    writeError(hrMessage("CoInitializeEx", hr));
    return 1;
  }

  std::vector<std::pair<std::wstring, std::wstring>> registryDevices;
  std::set<std::wstring> seenClsids;
  collectAsioRegistryDevices(HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY, registryDevices, seenClsids);
  collectAsioRegistryDevices(HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY, registryDevices, seenClsids);

  fprintf(stdout, "{\"devices\":[");
  bool first = true;
  for (const auto& registryDevice : registryDevices) {
    if (!first) fprintf(stdout, ",");
    first = false;
    std::string probedJson;
    if (probeDrivers && probeAsioDevice(registryDevice.first, registryDevice.second, probedJson)) {
      fprintf(stdout, "%s", probedJson.c_str());
    } else {
      std::string fallbackName = wideToUtf8(registryDevice.first.c_str());
      std::string clsidValue = wideToUtf8(registryDevice.second.c_str());
      fprintf(stdout,
              "{\"name\":\"%s\",\"deviceUID\":\"asio:%s\",\"driverName\":\"%s\",\"clsid\":\"%s\",\"available\":false,\"inputChannels\":0,\"outputChannels\":0,\"sampleRate\":0,\"preferredBufferSize\":0}",
              jsonEscape(fallbackName).c_str(),
              jsonEscape(clsidValue).c_str(),
              jsonEscape(fallbackName).c_str(),
              jsonEscape(clsidValue).c_str());
    }
  }
  fprintf(stdout, "]}\n");
  CoUninitialize();
  return 0;
}

static int probeAsioDeviceCommand(const std::wstring& clsidValue, const std::wstring& fallbackName) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(hr)) {
    writeError(hrMessage("CoInitializeEx", hr));
    return 1;
  }

  std::string outputJson;
  bool ok = probeAsioDevice(fallbackName.empty() ? clsidValue : fallbackName, clsidValue, outputJson);
  CoUninitialize();
  if (!ok) {
    writeError("Invalid ASIO CLSID");
    return 1;
  }
  fprintf(stdout, "%s\n", outputJson.c_str());
  return 0;
}

struct AsioCaptureState {
  IASIO* driver = nullptr;
  std::vector<ASIOBufferInfo> buffers;
  std::vector<ASIOChannelInfo> channelInfos;
  long channels = 0;
  long bufferSize = 0;
  ASIOSampleRate sampleRate = 48000.0;
  volatile LONG running = 0;
};

static AsioCaptureState* gAsioCaptureState = nullptr;

static float asioSampleToFloat(const void* sample, long type) {
  const uint8_t* bytes = static_cast<const uint8_t*>(sample);
  switch (type) {
    case ASIOSTFloat32LSB:
      return *static_cast<const float*>(sample);
    case ASIOSTFloat64LSB:
      return static_cast<float>(*static_cast<const double*>(sample));
    case ASIOSTInt16LSB:
      return pcmSampleToFloat(bytes, 2, 16);
    case ASIOSTInt24LSB:
      return pcmSampleToFloat(bytes, 3, 24);
    case ASIOSTInt32LSB:
      return pcmSampleToFloat(bytes, 4, 32);
    case ASIOSTInt32LSB16:
      return pcmSampleToFloat(bytes + 2, 2, 16);
    case ASIOSTInt32LSB18:
      return pcmSampleToFloat(bytes, 4, 18);
    case ASIOSTInt32LSB20:
      return pcmSampleToFloat(bytes, 4, 20);
    case ASIOSTInt32LSB24:
      return pcmSampleToFloat(bytes, 4, 24);
    default:
      return 0.0f;
  }
}

static int asioSampleBytes(long type) {
  switch (type) {
    case ASIOSTInt16LSB:
      return 2;
    case ASIOSTInt24LSB:
      return 3;
    case ASIOSTFloat64LSB:
      return 8;
    default:
      return 4;
  }
}

static void asioBufferSwitch(long doubleBufferIndex, ASIOBool) {
  AsioCaptureState* state = gAsioCaptureState;
  if (!state || InterlockedCompareExchange(&state->running, 1, 1) == 0) return;

  static std::vector<float> interleaved;
  interleaved.resize(static_cast<size_t>(state->bufferSize) * state->channels);

  for (long frame = 0; frame < state->bufferSize; ++frame) {
    for (long channel = 0; channel < state->channels; ++channel) {
      const ASIOChannelInfo& info = state->channelInfos[static_cast<size_t>(channel)];
      const int sampleBytes = asioSampleBytes(info.type);
      const uint8_t* channelBuffer =
        static_cast<const uint8_t*>(state->buffers[static_cast<size_t>(channel)].buffers[doubleBufferIndex]);
      interleaved[(static_cast<size_t>(frame) * state->channels) + channel] =
        asioSampleToFloat(channelBuffer + (static_cast<size_t>(frame) * sampleBytes), info.type);
    }
  }

  if (!writeAll(interleaved.data(), interleaved.size() * sizeof(float))) {
    InterlockedExchange(&state->running, 0);
  }
}

static void asioSampleRateDidChange(ASIOSampleRate) {}

static long asioMessage(ASIOMessageSelector, long, void*, double*) {
  return 0;
}

static ASIOTime* asioBufferSwitchTimeInfo(ASIOTime* params, long doubleBufferIndex, ASIOBool directProcess) {
  asioBufferSwitch(doubleBufferIndex, directProcess);
  return params;
}

static int streamAsioInput(const std::wstring& clsidValue, int requestedChannels) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(hr)) {
    writeError(hrMessage("CoInitializeEx", hr));
    return 1;
  }

  CLSID clsid = {};
  hr = CLSIDFromString(clsidValue.c_str(), &clsid);
  if (FAILED(hr)) {
    writeError("Invalid ASIO CLSID");
    CoUninitialize();
    return 1;
  }

  IASIO* driver = nullptr;
  hr = CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER, clsid, reinterpret_cast<void**>(&driver));
  if (FAILED(hr) || !driver) {
    writeError(hrMessage("CoCreateInstance(ASIO)", hr));
    CoUninitialize();
    return 1;
  }

  if (!driver->init(GetDesktopWindow())) {
    driver->Release();
    writeError("ASIO driver init failed");
    CoUninitialize();
    return 1;
  }

  long inputChannels = 0;
  long outputChannels = 0;
  ASIOError error = driver->getChannels(&inputChannels, &outputChannels);
  if (error != 0 || inputChannels <= 0) {
    driver->Release();
    writeError("ASIO driver has no input channels");
    CoUninitialize();
    return 1;
  }

  long minBuffer = 0;
  long maxBuffer = 0;
  long preferredBuffer = 0;
  long granularity = 0;
  error = driver->getBufferSize(&minBuffer, &maxBuffer, &preferredBuffer, &granularity);
  if (error != 0 || preferredBuffer <= 0) {
    preferredBuffer = 512;
  }

  ASIOSampleRate sampleRate = 0;
  if (driver->getSampleRate(&sampleRate) != 0 || sampleRate <= 0) {
    sampleRate = 44100.0;
  }

  AsioCaptureState state;
  state.driver = driver;
  state.channels = std::clamp<long>(requestedChannels > 0 ? requestedChannels : inputChannels, 1, inputChannels);
  state.bufferSize = preferredBuffer;
  state.sampleRate = sampleRate;
  state.buffers.resize(static_cast<size_t>(state.channels));
  state.channelInfos.resize(static_cast<size_t>(state.channels));

  for (long channel = 0; channel < state.channels; ++channel) {
    state.buffers[static_cast<size_t>(channel)] = {1, channel, {nullptr, nullptr}};
    ASIOChannelInfo info = {};
    info.channel = channel;
    info.isInput = 1;
    if (driver->getChannelInfo(&info) != 0) {
      info.type = ASIOSTFloat32LSB;
    }
    state.channelInfos[static_cast<size_t>(channel)] = info;
  }

  ASIOCallbacks callbacks = {};
  callbacks.bufferSwitch = asioBufferSwitch;
  callbacks.sampleRateDidChange = asioSampleRateDidChange;
  callbacks.asioMessage = asioMessage;
  callbacks.bufferSwitchTimeInfo = asioBufferSwitchTimeInfo;

  error = driver->createBuffers(state.buffers.data(), state.channels, state.bufferSize, &callbacks);
  if (error != 0) {
    driver->Release();
    writeError("ASIO createBuffers failed");
    CoUninitialize();
    return 1;
  }

  gAsioCaptureState = &state;
  InterlockedExchange(&state.running, 1);
  writeFormatEvent(static_cast<int>(sampleRate), static_cast<int>(state.channels));
  error = driver->start();
  if (error != 0) {
    gAsioCaptureState = nullptr;
    driver->disposeBuffers();
    driver->Release();
    writeError("ASIO start failed");
    CoUninitialize();
    return 1;
  }

  while (InterlockedCompareExchange(&state.running, 1, 1) != 0) {
    Sleep(100);
  }

  driver->stop();
  gAsioCaptureState = nullptr;
  driver->disposeBuffers();
  driver->Release();
  CoUninitialize();
  return 1;
}

static int captureInputDevice(const std::wstring& deviceId) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    writeError(hrMessage("CoInitializeEx", hr));
    return 1;
  }

  ComPtr<IMMDeviceEnumerator> enumerator;
  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator),
                        nullptr,
                        CLSCTX_ALL,
                        __uuidof(IMMDeviceEnumerator),
                        reinterpret_cast<void**>(enumerator.put()));
  if (FAILED(hr)) {
    writeError(hrMessage("CoCreateInstance(MMDeviceEnumerator)", hr));
    CoUninitialize();
    return 1;
  }

  ComPtr<IMMDevice> device;
  hr = enumerator->GetDevice(deviceId.c_str(), device.put());
  if (FAILED(hr)) {
    writeError(hrMessage("IMMDeviceEnumerator::GetDevice", hr));
    CoUninitialize();
    return 1;
  }

  ComPtr<IAudioClient> audioClient;
  hr = device->Activate(__uuidof(IAudioClient),
                        CLSCTX_ALL,
                        nullptr,
                        reinterpret_cast<void**>(audioClient.put()));
  if (FAILED(hr)) {
    writeError(hrMessage("IMMDevice::Activate(IAudioClient)", hr));
    CoUninitialize();
    return 1;
  }

  WAVEFORMATEX* mixFormat = nullptr;
  hr = getMixFormat(audioClient.get(), &mixFormat);
  if (FAILED(hr) || !mixFormat) {
    writeError(hrMessage("IAudioClient::GetMixFormat", FAILED(hr) ? hr : E_FAIL));
    CoUninitialize();
    return 1;
  }

  hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 1000000, 0, mixFormat, nullptr);
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    writeError(hrMessage("IAudioClient::Initialize", hr));
    CoUninitialize();
    return 1;
  }

  ComPtr<IAudioCaptureClient> captureClient;
  hr = audioClient->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(captureClient.put()));
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    writeError(hrMessage("IAudioClient::GetService", hr));
    CoUninitialize();
    return 1;
  }

  int result = runCaptureLoop(audioClient.get(), captureClient.get(), mixFormat);
  CoTaskMemFree(mixFormat);
  CoUninitialize();
  return result;
}

static int captureProcessLoopback(DWORD pid, int sampleRate, int channels, PROCESS_LOOPBACK_MODE mode) {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    writeError(hrMessage("CoInitializeEx", hr));
    return 1;
  }

  AUDIOCLIENT_ACTIVATION_PARAMS activationParams = {};
  activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activationParams.ProcessLoopbackParams.TargetProcessId = pid;
  activationParams.ProcessLoopbackParams.ProcessLoopbackMode = mode;

  PROPVARIANT prop = {};
  prop.vt = VT_BLOB;
  prop.blob.cbSize = sizeof(activationParams);
  prop.blob.pBlobData = reinterpret_cast<BYTE*>(&activationParams);

  ActivationHandler* handler = new ActivationHandler();
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                                   __uuidof(IAudioClient),
                                   &prop,
                                   handler,
                                   operation.put());
  if (FAILED(hr)) {
    handler->Release();
    writeError(hrMessage("ActivateAudioInterfaceAsync", hr));
    CoUninitialize();
    return 1;
  }

  hr = handler->wait();
  ComPtr<IAudioClient> audioClient;
  if (SUCCEEDED(hr)) audioClient.reset(handler->detachAudioClient());
  handler->Release();
  if (FAILED(hr) || !audioClient.get()) {
    writeError(hrMessage("Process loopback activation", FAILED(hr) ? hr : E_FAIL));
    CoUninitialize();
    return 1;
  }

  WAVEFORMATEXTENSIBLE requested = makeFloatFormat(sampleRate, channels);
  WAVEFORMATEX* format = &requested.Format;
  hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 1000000, 0, format, nullptr);
  if (FAILED(hr)) {
    writeError(hrMessage("IAudioClient::Initialize", hr));
    CoUninitialize();
    return 1;
  }

  ComPtr<IAudioCaptureClient> captureClient;
  hr = audioClient->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(captureClient.put()));
  if (FAILED(hr)) {
    writeError(hrMessage("IAudioClient::GetService", hr));
    CoUninitialize();
    return 1;
  }

  writeFormatEvent(sampleRate, channels);

  hr = audioClient->Start();
  if (FAILED(hr)) {
    writeError(hrMessage("IAudioClient::Start", hr));
    CoUninitialize();
    return 1;
  }

  DWORD mmcssTaskIndex = 0;
  HANDLE mmcssTask = AvSetMmThreadCharacteristicsW(L"Audio", &mmcssTaskIndex);
  std::vector<float> silence;

  while (true) {
    UINT32 packetFrames = 0;
    hr = captureClient->GetNextPacketSize(&packetFrames);
    if (FAILED(hr)) {
      writeError(hrMessage("IAudioCaptureClient::GetNextPacketSize", hr));
      break;
    }

    if (packetFrames == 0) {
      Sleep(5);
      continue;
    }

    BYTE* data = nullptr;
    UINT32 frames = 0;
    DWORD flags = 0;
    hr = captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
    if (FAILED(hr)) {
      writeError(hrMessage("IAudioCaptureClient::GetBuffer", hr));
      break;
    }

    size_t sampleCount = static_cast<size_t>(frames) * channels;
    if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
      silence.assign(sampleCount, 0.0f);
      if (!writeAll(silence.data(), silence.size() * sizeof(float))) {
        captureClient->ReleaseBuffer(frames);
        break;
      }
    } else {
      if (!writeAll(data, sampleCount * sizeof(float))) {
        captureClient->ReleaseBuffer(frames);
        break;
      }
    }

    captureClient->ReleaseBuffer(frames);
  }

  audioClient->Stop();
  if (mmcssTask) AvRevertMmThreadCharacteristics(mmcssTask);
  CoUninitialize();
  return 1;
}

int wmain(int argc, wchar_t** argv) {
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stderr), _O_TEXT);

  if (hasArg(argc, argv, L"--capabilities")) {
    fprintf(stdout,
            "{\"backendName\":\"windows-wasapi-process-loopback\",\"processLoopbackCapture\":true,\"inputDeviceCapture\":true,\"minimumWindowsBuild\":20348}\n");
    return 0;
  }

  if (hasArg(argc, argv, L"--list-input-devices")) {
    return listInputDevices();
  }

  if (hasArg(argc, argv, L"--list-output-devices")) {
    return listOutputDevices();
  }

  if (hasArg(argc, argv, L"--list-asio-devices")) {
    return listAsioDevices(hasArg(argc, argv, L"--probe"));
  }

  if (hasArg(argc, argv, L"--probe-asio-device")) {
    std::wstring clsid = argValue(argc, argv, L"--clsid", L"");
    std::wstring name = argValue(argc, argv, L"--name", L"");
    if (clsid.empty()) {
      writeError("Missing --clsid");
      return 2;
    }
    return probeAsioDeviceCommand(clsid, name);
  }

  if (hasArg(argc, argv, L"--stream-asio-input")) {
    std::wstring clsid = argValue(argc, argv, L"--clsid", L"");
    if (clsid.empty()) {
      writeError("Missing --clsid");
      return 2;
    }
    int channels = std::clamp(intArg(argc, argv, L"--channels", 2), 1, 64);
    return streamAsioInput(clsid, channels);
  }

  if (hasArg(argc, argv, L"--stream-input-device")) {
    std::wstring deviceId = argValue(argc, argv, L"--device-id", L"");
    if (deviceId.empty()) {
      writeError("Missing --device-id");
      return 2;
    }
    return captureInputDevice(deviceId);
  }

  if (!hasArg(argc, argv, L"--stream-process-loopback")) {
    fprintf(stderr,
            "Usage: SurroundAudioBackend.exe --list-input-devices | --list-output-devices | --list-asio-devices | --stream-input-device --device-id <id> | --stream-process-loopback --pid <pid> [--sample-rate 48000] [--channels 2] [--mode include-tree|exclude-tree]\n");
    return 2;
  }

  int pid = intArg(argc, argv, L"--pid", 0);
  if (pid <= 0) {
    writeError("Missing or invalid --pid");
    return 2;
  }

  int sampleRate = std::max(8000, intArg(argc, argv, L"--sample-rate", 48000));
  int channels = std::clamp(intArg(argc, argv, L"--channels", 2), 1, 8);
  std::wstring modeValue = argValue(argc, argv, L"--mode", L"include-tree");
  PROCESS_LOOPBACK_MODE mode = modeValue == L"exclude-tree"
                                 ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
                                 : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  return captureProcessLoopback(static_cast<DWORD>(pid), sampleRate, channels, mode);
}
