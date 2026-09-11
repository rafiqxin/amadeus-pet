import UIKit
import WebKit

final class HarnessViewController: UIViewController {
    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let mode = ProcessInfo.processInfo.environment["AMA_TEST_MODE"] ?? "touch"
        let safeMode = mode.replacingOccurrences(of: "'", with: "")
        let source = """
        window.__AMA_UI_TEST__ = true;
        window.__AMA_UI_TEST_MODE__ = '\(safeMode)';
        (() => {
          const original = HTMLMediaElement.prototype.play;
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

        guard let dist = Bundle.main.url(forResource: "dist", withExtension: nil),
              let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "dist") else {
            fatalError("dist/index.html missing from WKWebView harness bundle")
        }
        web.loadFileURL(index, allowingReadAccessTo: dist)
    }
}
