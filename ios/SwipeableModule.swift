import ExpoModulesCore

public class SwipeableModule: Module {
    public func definition() -> ModuleDefinition {
        Name("Swipeable")

        // Module-level functions (by recyclingKey)
        Function("openByKey") { (key: String) in
            SwipeableView.openByKey(key)
        }

        Function("closeByKey") { (key: String, animated: Bool?) in
            SwipeableView.closeByKey(key, animated: animated ?? true)
        }

        Function("closeAll") { (animated: Bool?) in
            SwipeableView.closeAll(animated: animated ?? true)
        }

        View(SwipeableView.self) {
            // Props
            Prop("actionsWidth") { (view: SwipeableView, width: CGFloat) in
                view.actionsWidth = width
            }

            Prop("actionsPosition") { (view: SwipeableView, position: String) in
                view.actionsPosition = position
            }

            Prop("friction") { (view: SwipeableView, friction: CGFloat) in
                view.friction = friction
            }

            Prop("threshold") { (view: SwipeableView, threshold: CGFloat) in
                view.threshold = threshold
            }

            Prop("dragOffsetFromEdge") { (view: SwipeableView, offset: CGFloat) in
                view.dragOffsetFromEdge = offset
            }

            Prop("recyclingKey") { (view: SwipeableView, key: String?) in
                view.recyclingKey = key
            }

            Prop("autoClose") { (view: SwipeableView, autoClose: Bool) in
                view.autoClose = autoClose
            }

            Prop("autoCloseTimeout") { (view: SwipeableView, timeout: CGFloat) in
                view.autoCloseTimeout = timeout
            }

            // Events
            Events("onSwipeProgress", "onSwipeStart", "onSwipeStateChange", "onSwipeEnd")

            // Imperative methods
            AsyncFunction("close") { (view: SwipeableView, animated: Bool?) in
                DispatchQueue.main.async {
                    view.close(animated: animated ?? true)
                }
            }

            AsyncFunction("open") { (view: SwipeableView) in
                DispatchQueue.main.async {
                    view.open()
                }
            }

            // Gesture handling methods (called from JS gesture handler)
            AsyncFunction("handleGestureStart") { (view: SwipeableView) in
                view.handleGestureStart()
            }

            AsyncFunction("handleGestureUpdate") { (view: SwipeableView, translationX: CGFloat, velocityX: CGFloat) in
                view.handleGestureUpdate(translationX: translationX, velocityX: velocityX)
            }

            AsyncFunction("handleGestureEnd") { (view: SwipeableView, translationX: CGFloat, velocityX: CGFloat) in
                view.handleGestureEnd(translationX: translationX, velocityX: velocityX)
            }
        }
    }
}
