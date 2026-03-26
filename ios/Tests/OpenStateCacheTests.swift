import XCTest
@testable import SwipeableActions

final class OpenStateCacheTests: XCTestCase {

    // MARK: - Basic Operations

    func testGet_returnsDefaultFalse() {
        let cache = OpenStateCache(maxSize: 10)
        XCTAssertFalse(cache.get("nonexistent"))
    }

    func testSetAndGet_returnsCachedValue() {
        let cache = OpenStateCache(maxSize: 10)
        cache.set("key-1", isOpen: true)
        // Wait for async write to complete
        waitForCacheSync(cache)
        XCTAssertTrue(cache.get("key-1"))
    }

    func testSetFalse_overwritesTrue() {
        let cache = OpenStateCache(maxSize: 10)
        cache.set("key-1", isOpen: true)
        waitForCacheSync(cache)
        cache.set("key-1", isOpen: false)
        waitForCacheSync(cache)
        XCTAssertFalse(cache.get("key-1"))
    }

    func testClear_removesKey() {
        let cache = OpenStateCache(maxSize: 10)
        cache.set("key-1", isOpen: true)
        waitForCacheSync(cache)
        cache.clear("key-1")
        waitForCacheSync(cache)
        XCTAssertFalse(cache.get("key-1"))
    }

    func testClearAll_removesAllKeys() {
        let cache = OpenStateCache(maxSize: 10)
        cache.set("key-1", isOpen: true)
        cache.set("key-2", isOpen: true)
        waitForCacheSync(cache)
        cache.clearAll()
        waitForCacheSync(cache)
        XCTAssertEqual(cache.count, 0)
    }

    // MARK: - Eviction

    func testEviction_removesEntriesWhenOverMaxSize() {
        let cache = OpenStateCache(maxSize: 3)
        cache.set("A", isOpen: true)
        cache.set("B", isOpen: true)
        cache.set("C", isOpen: true)
        waitForCacheSync(cache)
        XCTAssertEqual(cache.count, 3)

        // Adding a 4th should evict the oldest
        cache.set("D", isOpen: true)
        waitForCacheSync(cache)
        XCTAssertEqual(cache.count, 3)
        // A was inserted first, should be evicted
        XCTAssertFalse(cache.get("A"))
        XCTAssertTrue(cache.get("D"))
    }

    func testEvictionCount_onlyEvictsOnePerInsert() {
        let cache = OpenStateCache(maxSize: 3)
        cache.set("A", isOpen: true)
        cache.set("B", isOpen: true)
        cache.set("C", isOpen: true)
        waitForCacheSync(cache)

        // Insert one more - should evict exactly one
        cache.set("D", isOpen: true)
        waitForCacheSync(cache)
        XCTAssertEqual(cache.count, 3)
    }

    // MARK: - LRU Eviction Order (these should FAIL against current buggy code)

    /// The cache should behave as LRU: updating a key should promote it to most-recently-used,
    /// making it the LAST to be evicted. Currently, the code only tracks insertion order and
    /// never promotes on update, so frequently-used keys get evicted first.
    func testEvictionOrder_frequentlyUsedKeySurvivesEviction() {
        let cache = OpenStateCache(maxSize: 5)

        // Insert A first
        cache.set("A", isOpen: true)
        cache.set("B", isOpen: true)
        cache.set("C", isOpen: true)
        cache.set("D", isOpen: true)
        cache.set("E", isOpen: true)
        waitForCacheSync(cache)

        // Update A many times - this should promote it to most-recently-used
        for _ in 0..<50 {
            cache.set("A", isOpen: true)
        }
        waitForCacheSync(cache)

        // Now insert a new key, which should evict the OLDEST unused key (B),
        // NOT A (which was just updated 50 times)
        cache.set("F", isOpen: true)
        waitForCacheSync(cache)

        // A should survive because it was most recently used
        XCTAssertTrue(cache.get("A"), "Frequently updated key 'A' should NOT be evicted - it was the most recently used")
        // B should be evicted because it was the oldest unused key
        XCTAssertFalse(cache.get("B"), "Oldest unused key 'B' should be evicted")
        // F should be present (just inserted)
        XCTAssertTrue(cache.get("F"))
    }

    /// Updating a key should move it to the end of the eviction order.
    /// After updating A, then inserting D (triggering eviction), B should be evicted - not A.
    func testKeyPromotion_updateMovesToEndOfEvictionOrder() {
        let cache = OpenStateCache(maxSize: 3)

        cache.set("A", isOpen: true)
        cache.set("B", isOpen: true)
        cache.set("C", isOpen: true)
        waitForCacheSync(cache)

        // Update A with a new value - should promote it to end of eviction order
        cache.set("A", isOpen: true)
        waitForCacheSync(cache)

        // Insert D - triggers eviction of one entry.
        // With correct LRU: B should be evicted (oldest non-promoted).
        // With buggy code: A should be evicted (first inserted, never promoted).
        cache.set("D", isOpen: true)
        waitForCacheSync(cache)

        XCTAssertEqual(cache.count, 3, "Cache should have exactly maxSize entries")
        XCTAssertTrue(cache.get("A"), "A should survive eviction because it was recently updated (promoted)")
        XCTAssertFalse(cache.get("B"), "B should be evicted as the oldest non-promoted key")
        XCTAssertTrue(cache.get("C"), "C should survive (newer than B)")
        XCTAssertTrue(cache.get("D"), "D should be present (just inserted)")
    }

    // MARK: - Thread Safety

    func testConcurrentReadsDuringWrite_doesNotCrash() {
        let cache = OpenStateCache(maxSize: 100)
        let expectation = XCTestExpectation(description: "Concurrent access completes")
        expectation.expectedFulfillmentCount = 200

        let writeQueue = DispatchQueue(label: "test.write", attributes: .concurrent)
        let readQueue = DispatchQueue(label: "test.read", attributes: .concurrent)

        // Dispatch 100 writes
        for i in 0..<100 {
            writeQueue.async {
                cache.set("key-\(i)", isOpen: i % 2 == 0)
                expectation.fulfill()
            }
        }

        // Dispatch 100 concurrent reads
        for i in 0..<100 {
            readQueue.async {
                _ = cache.get("key-\(i)")
                expectation.fulfill()
            }
        }

        wait(for: [expectation], timeout: 5.0)
        // If we get here without crash, the test passes
    }

    func testConcurrentSetsAndEviction_doesNotCrash() {
        let cache = OpenStateCache(maxSize: 10)
        let expectation = XCTestExpectation(description: "Concurrent sets complete")
        expectation.expectedFulfillmentCount = 100

        let queue = DispatchQueue(label: "test.concurrent", attributes: .concurrent)

        // Dispatch 100 sets on a cache of size 10 - triggers lots of evictions
        for i in 0..<100 {
            queue.async {
                cache.set("key-\(i)", isOpen: true)
                expectation.fulfill()
            }
        }

        wait(for: [expectation], timeout: 5.0)
        // Cache should have at most maxSize entries
        XCTAssertLessThanOrEqual(cache.count, 10)
    }

    // MARK: - Helpers

    /// Wait for pending async writes to complete by doing a sync read
    private func waitForCacheSync(_ cache: OpenStateCache) {
        _ = cache.get("__sync__")
    }
}
