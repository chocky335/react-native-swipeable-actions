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

        Function("isOpenByKey") { (key: String) -> Bool in
            SwipeableView.getOpenState(for: key)
        }

        Function("openByKeyOnSide") { (key: String, side: String) in
            SwipeableView.openByKeyOnSide(key, side: side)
        }

        Function("getOpenSideByKey") { (key: String) -> String? in
            SwipeableView.getOpenSide(for: key)
        }

        View(SwipeableView.self) {
            Prop("twoSided") { (view: SwipeableView, value: Bool) in
                view.twoSided = value
            }

            Prop("leftActionsWidth") { (view: SwipeableView, width: CGFloat) in
                view.leftActionsWidth = width
            }

            Prop("rightActionsWidth") { (view: SwipeableView, width: CGFloat) in
                view.rightActionsWidth = width
            }

            Prop("appearance") { (view: SwipeableView, value: String) in
                view.appearance = value
            }

            Prop("hapticFeedback") { (view: SwipeableView, value: Bool?) in
                view.hapticFeedback = value
            }

            OnViewDidUpdateProps { (view: SwipeableView) in
                view.commitProps()
            }

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

            Prop("gestureEnabled") { (view: SwipeableView, enabled: Bool) in
                view.gestureEnabled = enabled
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
            Events("onSwipeProgress", "onSwipeStart", "onSwipeStateChange", "onSwipeEnd", "onActionsNeeded")

            // Imperative methods
            AsyncFunction("close") { (view: SwipeableView, animated: Bool?) in
                view.enqueueCommand {
                    $0.close(animated: animated ?? true)
                }
            }

            AsyncFunction("open") { (view: SwipeableView) in
                view.enqueueCommand {
                    $0.open()
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
