import Foundation

/// Thread-safe LRU cache for tracking open/closed state of swipeable views by recycling key.
/// Used by the static registry in SwipeableView to persist state across list recycling.
public class OpenStateCache {
    private let queue: DispatchQueue
    private let maxSize: Int
    private var cache: [String: Bool] = [:]
    private var insertionOrder: [String] = []

    public init(maxSize: Int = 1000, queueLabel: String = "com.swipeable.openstate") {
        self.maxSize = maxSize
        self.queue = DispatchQueue(label: queueLabel, qos: .userInteractive)
    }

    /// Read the cached open state for a key. Returns false if not found.
    public func get(_ key: String) -> Bool {
        queue.sync { cache[key] ?? false }
    }

    /// Set the open state for a key. Promotes existing keys to most-recently-used.
    /// Evicts the least-recently-used entry when cache exceeds max size.
    public func set(_ key: String, isOpen: Bool) {
        queue.async(flags: .barrier) { [self] in
            if cache[key] != nil {
                insertionOrder.removeAll { $0 == key }
            }
            insertionOrder.append(key)
            cache[key] = isOpen
            if insertionOrder.count > maxSize {
                let oldest = insertionOrder.removeFirst()
                cache.removeValue(forKey: oldest)
            }
        }
    }

    /// Remove a specific key from the cache.
    public func clear(_ key: String) {
        queue.async(flags: .barrier) { [self] in
            cache.removeValue(forKey: key)
            insertionOrder.removeAll { $0 == key }
        }
    }

    /// Remove all entries from the cache.
    public func clearAll() {
        queue.async(flags: .barrier) { [self] in
            cache.removeAll()
            insertionOrder.removeAll()
        }
    }

    /// Synchronously return the number of entries (for testing).
    public var count: Int {
        queue.sync { cache.count }
    }
}
