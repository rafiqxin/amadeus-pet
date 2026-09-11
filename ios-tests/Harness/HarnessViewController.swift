import UIKit
import WebKit

final class HarnessViewController: UIViewController, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let probeLabel = UILabel()

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "amaTest")

        let mode = ProcessInfo.processInfo.environment["AMA_TEST_MODE"] ?? "touch"
        let safeMode = mode.replacingOccurrences(of: "'", with: "")
        let source = """
        window.__AMA_UI_TEST__ = true;
        window.__AMA_UI_TEST_MODE__ = '\(safeMode)';
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
        web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 AMA-DEUS-XCUITEST"
        web.scrollView.isScrollEnabled = false
        web.isAccessibilityElement = false
        self.webView = web
        self.view = web

        // DOM nodes inside WKWebView are not guaranteed to surface as stable
        // XCUI elements. The JS app posts probe state through amaTest; this tiny
        // native label is the deterministic accessibility bridge used by XCUITest.
        probeLabel.frame = CGRect(x: 2, y: 2, width: 388, height: 14)
        probeLabel.font = UIFont.monospacedSystemFont(ofSize: 6, weight: .regular)
        probeLabel.textColor = .white
        probeLabel.backgroundColor = UIColor.black.withAlphaComponent(0.75)
        probeLabel.numberOfLines = 1
        probeLabel.isUserInteractionEnabled = false
        probeLabel.isAccessibilityElement = true
        probeLabel.accessibilityIdentifier = "AMA_TEST_PROBE"
        probeLabel.accessibilityLabel = "AMA_TEST_PROBE boot"
        probeLabel.text = "AMA_TEST_PROBE boot"
        web.addSubview(probeLabel)

        guard let dist = Bundle.main.url(forResource: "dist", withExtension: nil),
              let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "dist") else {
            fatalError("dist/index.html missing from WKWebView harness bundle")
        }
        web.loadFileURL(index, allowingReadAccessTo: dist)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "amaTest", let body = message.body as? [String: Any] else { return }
        let intValue: (String) -> Int = { key in
            if let n = body[key] as? NSNumber { return n.intValue }
            if let n = body[key] as? Int { return n }
            if let s = body[key] as? String { return Int(s) ?? 0 }
            return 0
        }
        let voice = String(describing: body["voice"] ?? "IDLE")
        let text = "AMA_TEST_PROBE ready=\(intValue("ready")) reactions=\(intValue("reactions")) audio=\(intValue("audio")) scroll=\(intValue("scroll")) max=\(intValue("max")) scrollable=\(intValue("scrollable")) scrolled=\(intValue("scrolled")) voice=\(voice)"
        DispatchQueue.main.async { [weak self] in
            self?.probeLabel.text = text
            self?.probeLabel.accessibilityLabel = text
        }
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "amaTest")
    }
}
