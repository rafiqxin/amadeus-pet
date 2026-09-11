// AMA-DEUS native speech bridge.
// Injected into the generated Capacitor App target by the iOS preview workflow.

@objc(NativeSpeechPlugin)
public class NativeSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSpeechPlugin"
    public let jsName = "NativeSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let audioEngine = AVAudioEngine()
    private var recognitionTask: SFSpeechRecognitionTask?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var pendingStartCall: CAPPluginCall?
    private var bestTranscript = ""
    private var silenceTimer: Timer?

    @objc func available(_ call: CAPPluginCall) {
        let locale = call.getString("language") ?? "zh-CN"
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
        call.resolve(["available": recognizer != nil])
    }

    private func permissionPayload() -> [String: String] {
        let speech: String
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: speech = "granted"
        case .denied, .restricted: speech = "denied"
        case .notDetermined: speech = "prompt"
        @unknown default: speech = "denied"
        }

        let microphone: String
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: microphone = "granted"
        case .denied: microphone = "denied"
        case .undetermined: microphone = "prompt"
        @unknown default: microphone = "denied"
        }
        return ["speechRecognition": speech, "microphone": microphone]
    }

    @objc func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(permissionPayload())
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { [weak self] _ in
            guard let self else { return }
            AVAudioSession.sharedInstance().requestRecordPermission { _ in
                DispatchQueue.main.async {
                    call.resolve(self.permissionPayload())
                }
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.beginRecognition(call)
        }
    }

    private func beginRecognition(_ call: CAPPluginCall) {
        guard pendingStartCall == nil else {
            call.reject("语音识别已经在运行")
            return
        }
        let perms = permissionPayload()
        guard perms["speechRecognition"] == "granted", perms["microphone"] == "granted" else {
            call.reject("需要麦克风与语音识别权限")
            return
        }

        let language = call.getString("language") ?? "zh-CN"
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)), recognizer.isAvailable else {
            call.reject("当前系统语音识别服务不可用")
            return
        }

        cleanupAudio()
        bestTranscript = ""
        pendingStartCall = call

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            recognitionRequest = request

            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }
                DispatchQueue.main.async {
                    if let result {
                        self.bestTranscript = result.bestTranscription.formattedString
                        self.armSilenceTimer()
                        if result.isFinal {
                            self.finishRecognition(success: true)
                            return
                        }
                    }
                    if error != nil {
                        self.finishRecognition(
                            success: !self.bestTranscript.isEmpty,
                            message: "语音识别失败"
                        )
                    }
                }
            }

            audioEngine.prepare()
            try audioEngine.start()
            armSilenceTimer(initial: true)
        } catch {
            finishRecognition(success: false, message: "无法启动麦克风：\(error.localizedDescription)")
        }
    }

    private func armSilenceTimer(initial: Bool = false) {
        silenceTimer?.invalidate()
        let delay: TimeInterval = initial ? 8.0 : 1.35
        silenceTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.finishRecognition(success: true)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.finishRecognition(success: true)
            call.resolve()
        }
    }

    private func finishRecognition(success: Bool, message: String? = nil) {
        let startCall = pendingStartCall
        pendingStartCall = nil
        let transcript = bestTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        cleanupAudio()

        guard let startCall else { return }
        if success {
            startCall.resolve(["matches": transcript.isEmpty ? [] : [transcript]])
        } else {
            startCall.reject(message ?? "语音识别失败")
        }
    }

    private func cleanupAudio() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

public class MainViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeSpeechPlugin())
    }
}
