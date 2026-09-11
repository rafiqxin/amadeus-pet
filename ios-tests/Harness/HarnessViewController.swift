import UIKit
import WebKit

private final class DistSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "AMA-DEUS.Harness", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing request URL"]))
            return
        }

        var relative = requestURL.path.removingPercentEncoding ?? requestURL.path
        if relative.isEmpty || relative == "/" { relative = "/index.html" }
        relative = relative.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !relative.split(separator: "/").contains("..") else {
            urlSchemeTask.didFailWithError(NSError(domain: "AMA-DEUS.Harness", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unsafe path"]))
            return
        }

        let fileURL = root.appendingPathComponent(relative).standardizedFileURL
        guard fileURL.path.hasPrefix(root.path + "/") || fileURL == root else {
            urlSchemeTask.didFailWithError(NSError(domain: "AMA-DEUS.Harness", code: 3, userInfo: [NSLocalizedDescriptionKey: "Path escaped dist root"]))
            return
        }

        do {
            let data = try Data(contentsOf: fileURL)
            let ext = fileURL.pathExtension.lowercased()
            let mime: String
            switch ext {
            case "html": mime = "text/html"
            case "js", "mjs": mime = "text/javascript"
            case "css": mime = "text/css"
            case "json": mime = "application/json"
            case "png": mime = "image/png"
            case "jpg", "jpeg": mime = "image/jpeg"
            case "ogg": mime = "audio/ogg"
            case "wav": mime = "audio/wav"
            case "moc": mime = "application/octet-stream"
            default: mime = "application/octet-stream"
            }
            let encoding = mime.hasPrefix("text/") || mime == "application/json" ? "utf-8" : nil
            let response = URLResponse(url: requestURL, mimeType: mime, expectedContentLength: data.count, textEncodingName: encoding)
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

final class HarnessViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var webView: WKWebView!
    private var schemeHandler: DistSchemeHandler!
    private let probeLabel = UILabel()
    private var probeSequence = 0

    override func loadView() {
        guard let dist = Bundle.main.url(forResource: "dist", withExtension: nil) else {
            fatalError("dist directory missing from WKWebView harness bundle")
        }

        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "amaTest")

        schemeHandler = DistSchemeHandler(root: dist)
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "amadeus")

        let mode = ProcessInfo.processInfo.environment["AMA_TEST_MODE"] ?? "touch"
        let safeMode = mode.replacingOccurrences(of: "'", with: "")
        let source = """
        window.__AMA_UI_TEST__ = true;
        window.__AMA_UI_TEST_MODE__ = '\(safeMode)';
        window.addEventListener('error', (event) => {
          try { window.webkit.messageHandlers.amaTest.postMessage({ fatal: 'JS_ERROR:' + String(event.message || 'unknown') }); } catch (_) {}
        });
        window.addEventListener('unhandledrejection', (event) => {
          try { window.webkit.messageHandlers.amaTest.postMessage({ fatal: 'PROMISE_ERROR:' + String(event.reason || 'unknown') }); } catch (_) {}
        });
        (() => {
          HTMLMediaElement.prototype.play = function() {
            window.__AMA_TEST_PLAY_CALLS__ = (window.__AMA_TEST_PLAY_CALLS__ || 0) + 1;
            const media = this;
            setTimeout(() => { try { media.dispatchEvent(new Event('ended')); } catch (_) {} }, 140);
            return Promise.resolve();
          };
        })();
        """
        config.userContentController.addUserScript(
            WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 AMA-DEUS-XCUITEST"
        web.scrollView.isScrollEnabled = false
        web.isAccessibilityElement = false
        self.webView = web
        self.view = web

        // DOM nodes inside WKWebView are not guaranteed to surface as stable
        // XCUI elements. The JS app posts probe state through amaTest; this tiny
        // native label is the deterministic accessibility bridge used by XCUITest.
        probeLabel.frame = CGRect(x: 2, y: 2, width: 398, height: 14)
        probeLabel.font = UIFont.monospacedSystemFont(ofSize: 5, weight: .regular)
        probeLabel.textColor = .white
        probeLabel.backgroundColor = UIColor.black.withAlphaComponent(0.75)
        probeLabel.numberOfLines = 1
        probeLabel.isUserInteractionEnabled = false
        probeLabel.isAccessibilityElement = true
        probeLabel.accessibilityIdentifier = "AMA_TEST_PROBE"
        setProbe("AMA_TEST_PROBE boot")
        web.addSubview(probeLabel)

        // Vite emits ES modules and the production Capacitor shell serves them
        // from a local app origin rather than file://. A dedicated WKURLSchemeHandler
        // gives the simulator harness the same origin semantics so module scripts,
        // XHR model loads and absolute /Resources URLs execute inside real WKWebView.
        guard let startURL = URL(string: "amadeus://app/index.html") else {
            fatalError("Unable to construct harness start URL")
        }
        web.load(URLRequest(url: startURL))
    }

    private func setProbe(_ text: String) {
        probeLabel.text = text
        probeLabel.accessibilityLabel = text
    }

    private func intValue(_ body: [String: Any], _ key: String) -> Int {
        if let n = body[key] as? NSNumber { return n.intValue }
        if let n = body[key] as? Int { return n }
        if let s = body[key] as? String { return Int(s) ?? 0 }
        return 0
    }

    private func publishProbe(_ body: [String: Any]) {
        probeSequence += 1
        let sequence = probeSequence
        let voice = String(describing: body["voice"] ?? "IDLE")
        let base = "AMA_TEST_PROBE ready=\(intValue(body, "ready")) reactions=\(intValue(body, "reactions")) audio=\(intValue(body, "audio")) scroll=\(intValue(body, "scroll")) max=\(intValue(body, "max")) scrollable=\(intValue(body, "scrollable")) scrolled=\(intValue(body, "scrolled")) voice=\(voice)"

        // The scroll test must gesture on the real rendered transcript, not a
        // guessed screen coordinate. Read its live DOM rect and bridge the
        // normalized center to XCUITest as integer ten-thousandths of the
        // WKWebView viewport. There is no scrollbar element any more: the
        // transcript is scrolled with a finger, so the transcript itself is the
        // gesture target.
        let geometryScript = """
        (() => {
          const target = document.querySelector('.call-subtitle');
          if (!target) return null;
          const r = target.getBoundingClientRect();
          const w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
          const h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
          return {
            x: Math.round(((r.left + r.width / 2) / w) * 10000),
            y: Math.round(((r.top + r.height / 2) / h) * 10000),
            width: Math.round(r.width),
            height: Math.round(r.height)
          };
        })()
        """
        webView.evaluateJavaScript(geometryScript) { [weak self] result, _ in
            guard let self, sequence == self.probeSequence else { return }
            var targetX = -1
            var targetY = -1
            var targetW = 0
            var targetH = 0
            if let geometry = result as? [String: Any] {
                func number(_ key: String) -> Int {
                    if let n = geometry[key] as? NSNumber { return n.intValue }
                    if let n = geometry[key] as? Int { return n }
                    return 0
                }
                targetX = number("x")
                targetY = number("y")
                targetW = number("width")
                targetH = number("height")
            }
            self.setProbe("\(base) targetX=\(targetX) targetY=\(targetY) targetW=\(targetW) targetH=\(targetH)")
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // This only confirms document navigation. Renderer readiness still must
        // arrive through the JS amaTest bridge and is what XCUITest waits for.
        if probeLabel.accessibilityLabel == "AMA_TEST_PROBE boot" {
            setProbe("AMA_TEST_PROBE document-loaded")
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        setProbe("AMA_TEST_PROBE NAV_ERROR \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        setProbe("AMA_TEST_PROBE PROVISIONAL_ERROR \(error.localizedDescription)")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "amaTest", let body = message.body as? [String: Any] else { return }
        if let fatal = body["fatal"] {
            probeSequence += 1
            DispatchQueue.main.async { [weak self] in
                self?.setProbe("AMA_TEST_PROBE \(String(describing: fatal))")
            }
            return
        }
        publishProbe(body)
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "amaTest")
    }
}
