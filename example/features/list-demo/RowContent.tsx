import { useMemo } from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import { RowContentProps } from './types'
import { colors, avatarColors } from '../../styles/theme'

function getColorIndex(id: string): number {
  const match = id.match(/\d+/)
  return match ? parseInt(match[0], 10) % avatarColors.length : 0
}

export function RowContent({ item, onPress }: RowContentProps) {
  const avatarColor = avatarColors[getColorIndex(item.id)]
  const avatarStyle = useMemo(
    () => [styles.avatar, { backgroundColor: avatarColor }],
    [avatarColor]
  )

  return (
    <TouchableOpacity
      style={styles.rowContent}
      onPress={onPress}
      testID={`row-pressable-${item.id}`}
    >
      <View style={avatarStyle}>
        <Text style={styles.avatarText}>{item.title.charAt(item.title.length - 1)}</Text>
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.subtitle}>{item.subtitle}</Text>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: colors.backgroundSurface,
    height: 87
  },
  avatar: {
    width: 55,
    height: 55,
    borderRadius: 27.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12
  },
  avatarText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: 'bold'
  },
  textContainer: {
    flex: 1
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2
  }
})
