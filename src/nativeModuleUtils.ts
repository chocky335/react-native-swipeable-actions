import { SwipeableModule } from './SwipeableView'
import type { SwipeSide } from './Swipeable.types'

export interface NativeModuleError {
  code: string
  message: string
  nativeStackTrace?: string
}

export type SwipeableErrorHandler = (
  error: NativeModuleError,
  operation: string,
  key?: string
) => void

let globalErrorHandler: SwipeableErrorHandler | undefined

export function setGlobalErrorHandler(handler: SwipeableErrorHandler | undefined): void {
  globalErrorHandler = handler
}

function handleNativeError(error: unknown, operation: string, key?: string): void {
  const nativeError: NativeModuleError = {
    code: 'SWIPEABLE_NATIVE_ERROR',
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { nativeStackTrace: error.stack } : {})
  }

  if (globalErrorHandler) {
    globalErrorHandler(nativeError, operation, key)
  } else if (__DEV__) {
    console.error(`[Swipeable] ${operation} failed:`, nativeError.message)
  }
}

export function openByKey(key: string): void {
  try {
    SwipeableModule.openByKey(key)
  } catch (error) {
    handleNativeError(error, 'openByKey', key)
  }
}

export function openByKeyOnSide(key: string, side: SwipeSide): void {
  try {
    SwipeableModule.openByKeyOnSide(key, side)
  } catch (error) {
    handleNativeError(error, 'openByKeyOnSide', key)
  }
}

export function getOpenSideByKey(key: string): SwipeSide | null {
  try {
    const side = SwipeableModule.getOpenSideByKey(key)
    return side === 'left' || side === 'right' ? side : null
  } catch (error) {
    handleNativeError(error, 'getOpenSideByKey', key)
    return null
  }
}

export function closeByKey(key: string, animated?: boolean): void {
  try {
    SwipeableModule.closeByKey(key, animated)
  } catch (error) {
    handleNativeError(error, 'closeByKey', key)
  }
}

export function cancelByKey(key: string): void {
  try {
    SwipeableModule.cancelByKey(key)
  } catch (error) {
    handleNativeError(error, 'cancelByKey', key)
  }
}

export function closeAll(animated?: boolean): void {
  try {
    SwipeableModule.closeAll(animated)
  } catch (error) {
    handleNativeError(error, 'closeAll')
  }
}
