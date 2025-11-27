const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

// Watch the parent directory for the local package
config.watchFolders = [workspaceRoot]

// Block duplicate React from root node_modules
config.resolver.blockList = [
  new RegExp(
    path.resolve(workspaceRoot, 'node_modules', 'react', '.*').replace(/[/\\]/g, '[/\\\\]')
  ),
  new RegExp(
    path.resolve(workspaceRoot, 'node_modules', 'react-native', '.*').replace(/[/\\]/g, '[/\\\\]')
  ),
  new RegExp(
    path
      .resolve(workspaceRoot, 'node_modules', 'react-native-reanimated', '.*')
      .replace(/[/\\]/g, '[/\\\\]')
  )
]

// Only resolve from example's node_modules - NOT library's node_modules
// This prevents duplicate React instances
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]

// Force shared dependencies to resolve from example's node_modules only
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (target, name) => {
      // First try example's node_modules
      const examplePath = path.join(projectRoot, 'node_modules', name)
      try {
        require.resolve(examplePath)
        return examplePath
      } catch {
        // Fall back to workspace root for the library itself
        return path.join(workspaceRoot, 'node_modules', name)
      }
    }
  }
)

// Ensure symlinks are followed
config.resolver.unstable_enableSymlinks = true

module.exports = config
