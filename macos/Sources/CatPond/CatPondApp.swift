import SwiftUI
import AppKit

@MainActor
final class AppServices: NSObject, ObservableObject, NSWindowDelegate {
    static let shared = AppServices()
    let store = PondStore()
    lazy var bluetooth = BluetoothManager(store: store)
    @Published var section = "aquarium"
    private var panel: PondPanel?
    private var detailWindow: NSWindow?

    func launch() {
        store.showPond = { [weak self] in self?.showPond() }
        store.hidePond = { [weak self] in self?.hidePond() }
        store.openDetails = { [weak self] section in self?.showDetails(section) }
        store.setPinned = { [weak self] pinned in self?.panel?.level = pinned ? .floating : .normal }
        showPond()
        bluetooth.restoreIfNeeded()
    }
    func showPond() {
        if panel == nil {
            let window = PondPanel(contentRect: NSRect(x: 0, y: 0, width: 460, height: 345),
                                   styleMask: [.borderless, .resizable, .nonactivatingPanel], backing: .buffered, defer: false)
            window.title = "小貓釣魚"
            window.isOpaque = false; window.backgroundColor = .clear; window.hasShadow = true
            window.hidesOnDeactivate = false; window.isReleasedWhenClosed = false
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            window.contentAspectRatio = NSSize(width: 4, height: 3)
            window.minSize = NSSize(width: 340, height: 255)
            window.maxSize = NSSize(width: 800, height: 600)
            let hosting = NSHostingView(rootView: PondScene(store: store))
            // Floating scenes keep their user-selected size as catch cards appear/disappear.
            hosting.sizingOptions = []
            window.contentView = hosting
            if !window.setFrameUsingName("CatPondFloating") {
                if let screen = NSScreen.main?.visibleFrame {
                    window.setFrameOrigin(NSPoint(x: screen.maxX - 484, y: screen.minY + 26))
                }
            }
            window.setFrameAutosaveName("CatPondFloating")
            panel = window
        }
        panel?.level = store.data.pinned ? .floating : .normal
        store.pondVisible = true; panel?.orderFrontRegardless()
    }
    func hidePond() { panel?.orderOut(nil); store.pondVisible = false }
    func showDetails(_ section: String) {
        self.section = section
        if detailWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 950, height: 690),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "小貓釣魚"; window.isReleasedWhenClosed = false
            window.delegate = self
            window.contentView = NSHostingView(rootView: DetailRoot(services: self))
            window.minSize = NSSize(width: 820, height: 620)
            window.center(); window.setFrameAutosaveName("CatPondDetails")
            detailWindow = window
        }
        NSApp.activate(ignoringOtherApps: true)
        detailWindow?.makeKeyAndOrderFront(nil)
    }
    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, window === detailWindow else { return }
        // Release the hosted aquarium so its animation timeline does not run after closing.
        window.contentView = nil
        detailWindow = nil
    }
}

final class PondPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

struct DetailRoot: View {
    @ObservedObject var services: AppServices
    var body: some View {
        DetailView(store: services.store, bluetooth: services.bluetooth, selection: $services.section)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) { AppServices.shared.launch() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        AppServices.shared.showPond(); return true
    }
}

@main
struct CatPondApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    private let services = AppServices.shared
    var body: some Scene {
        MenuBarExtra("小貓釣魚", systemImage: "drop.fill") {
            MenuContent(store: services.store, bluetooth: services.bluetooth)
        }.menuBarExtraStyle(.window)
    }
}
