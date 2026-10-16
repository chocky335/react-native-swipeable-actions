package expo.modules.swipeable

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SwipeableModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("Swipeable")

        // Module-level functions (by recyclingKey)
        Function("openByKey") { key: String ->
            SwipeableView.openByKey(key)
        }

        Function("openByKeyOnSide") { key: String, side: String? ->
            SwipeableView.openByKeyOnSide(key, SwipeSide.fromValue(side))
        }

        Function("closeByKey") { key: String, animated: Boolean? ->
            SwipeableView.closeByKey(key, animated ?: true)
        }

        Function("cancelByKey") { key: String ->
            SwipeableView.cancelByKey(key)
        }

        Function("closeAll") { animated: Boolean? ->
            SwipeableView.closeAll(animated ?: true)
        }

        Function("isOpenByKey") { key: String ->
            SwipeableView.isOpenByKey(key)
        }

        Function("getOpenSideByKey") { key: String ->
            SwipeableView.getOpenSideByKey(key)
        }

        View(SwipeableView::class) {

            Prop("friction") { view: SwipeableView, friction: Float ->
                view.friction = friction.coerceIn(0f, 1f)
            }
            Prop("threshold") { view: SwipeableView, threshold: Float ->
                view.threshold = threshold.coerceIn(0f, 1f)
            }
            Prop("gestureEnabled") { view: SwipeableView, enabled: Boolean ->
                view.gestureEnabled = enabled
            }
            Prop("dragOffsetFromEdge") { view: SwipeableView, offset: Float ->
                view.dragOffsetFromEdge = offset
            }
            Prop("recyclingKey") { view: SwipeableView, key: String? ->
                view.recyclingKey = key
            }
            Prop("autoClose") { view: SwipeableView, autoClose: Boolean ->
                view.autoClose = autoClose
            }
            Prop("autoCloseTimeout") { view: SwipeableView, timeout: Float ->
                view.autoCloseTimeout = timeout
            }

            Prop("leftActionsWidth") { view: SwipeableView, width: Float ->
                view.leftActionsWidth = width
            }
            Prop("rightActionsWidth") { view: SwipeableView, width: Float ->
                view.rightActionsWidth = width
            }

            OnViewDidUpdateProps { view: SwipeableView ->
                view.applyPendingConfiguration()
            }

            Events("onSwipeProgress", "onSwipeStart", "onSwipeStateChange", "onSwipeEnd", "onActionsNeeded", "onGestureCancelled")

            AsyncFunction("close") { view: SwipeableView, animated: Boolean? ->
                view.postCommand { view.close(animated ?: true) }
            }
            AsyncFunction("open") { view: SwipeableView ->
                view.postCommand { view.open() }
            }
            AsyncFunction("cancel") { view: SwipeableView ->
                view.postCommand { view.cancelGesture() }
            }

            AsyncFunction("handleGestureStart") { view: SwipeableView ->
                view.handleGestureStart()
            }
            AsyncFunction("handleGestureUpdate") { view: SwipeableView, translationX: Float, velocityX: Float ->
                view.handleGestureUpdate(translationX, velocityX)
            }
            AsyncFunction("handleGestureEnd") { view: SwipeableView, translationX: Float, velocityX: Float ->
                view.handleGestureEnd(translationX, velocityX)
            }
        }
    }
}
