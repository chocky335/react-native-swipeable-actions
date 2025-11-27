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

        Function("closeByKey") { key: String, animated: Boolean? ->
            SwipeableView.closeByKey(key, animated ?: true)
        }

        Function("closeAll") { animated: Boolean? ->
            SwipeableView.closeAll(animated ?: true)
        }

        View(SwipeableView::class) {
            Prop("actionsWidth") { view: SwipeableView, width: Float ->
                view.actionsWidth = width
            }
            Prop("actionsPosition") { view: SwipeableView, position: String ->
                view.actionsPosition = position
            }
            Prop("friction") { view: SwipeableView, friction: Float ->
                view.friction = friction.coerceIn(0f, 1f)
            }
            Prop("threshold") { view: SwipeableView, threshold: Float ->
                view.threshold = threshold.coerceIn(0f, 1f)
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

            Events("onSwipeProgress", "onSwipeStart", "onSwipeStateChange", "onSwipeEnd")

            AsyncFunction("close") { view: SwipeableView, animated: Boolean? ->
                view.post { view.close(animated ?: true) }
            }
            AsyncFunction("open") { view: SwipeableView ->
                view.post { view.open() }
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
