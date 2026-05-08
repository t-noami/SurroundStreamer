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
  format.dwChannelMask = channels == 1 ? SPEAKER_FRONT_CENTER : SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
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

static int listInputDevices() {
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
  hr = enumerator->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, collection.put());
  if (FAILED(hr)) {
    writeError(hrMessage("EnumAudioEndpoints(eCapture)", hr));
    CoUninitialize();
    return 1;
  }

  UINT count = 0;
  collection->GetCount(&count);
  fprintf(stdout, "{\"devices\":[");
  bool first = true;
  for (UINT index = 0; index < count; ++index) {
    ComPtr<IMMDevice> device;
    if (FAILED(collection->Item(index, device.put()))) continue;

    LPWSTR id = nullptr;
    if (FAILED(device->GetId(&id))) continue;

    std::string name = "Windows Audio Input";
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
            "Usage: SurroundAudioBackend.exe --list-input-devices | --stream-input-device --device-id <id> | --stream-process-loopback --pid <pid> [--sample-rate 48000] [--channels 2] [--mode include-tree|exclude-tree]\n");
    return 2;
  }

  int pid = intArg(argc, argv, L"--pid", 0);
  if (pid <= 0) {
    writeError("Missing or invalid --pid");
    return 2;
  }

  int sampleRate = std::max(8000, intArg(argc, argv, L"--sample-rate", 48000));
  int channels = std::clamp(intArg(argc, argv, L"--channels", 2), 1, 2);
  std::wstring modeValue = argValue(argc, argv, L"--mode", L"include-tree");
  PROCESS_LOOPBACK_MODE mode = modeValue == L"exclude-tree"
                                 ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
                                 : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  return captureProcessLoopback(static_cast<DWORD>(pid), sampleRate, channels, mode);
}
