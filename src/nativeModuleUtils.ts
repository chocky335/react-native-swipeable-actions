import { SwipeableModule } from './SwipeableView'

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

export function closeByKey(key: string, animated?: boolean): void {
  try {
    SwipeableModule.closeByKey(key, animated)
  } catch (error) {
    handleNativeError(error, 'closeByKey', key)
  }
}

export function closeAll(animated?: boolean): void {
  try {
    SwipeableModule.closeAll(animated)
  } catch (error) {
    handleNativeError(error, 'closeAll')
  }
}
