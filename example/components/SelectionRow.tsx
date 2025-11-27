import { useCallback } from 'react'
import { Text, View, TouchableOpacity } from 'react-native'
import { buttonStyles, layoutStyles } from '../styles'

export interface SelectionOption<T> {
  label: string
  value: T
  testID: string
}

export interface SelectionRowProps<T> {
  label: string
  options: SelectionOption<T>[]
  value: T
  onChange: (value: T) => void
}

export function SelectionRow<T>({ label, options, value, onChange }: SelectionRowProps<T>) {
  return (
    <View style={layoutStyles.controlRow}>
      <Text style={layoutStyles.controlLabel}>{label}</Text>
      <View style={layoutStyles.pickerRow}>
        {options.map((option) => {
          const isActive = option.value === value
          return (
            <TouchableOpacity
              key={option.testID}
              testID={option.testID}
              style={[buttonStyles.smallPill, isActive && buttonStyles.pillActive]}
              onPress={() => onChange(option.value)}
            >
              <Text style={[buttonStyles.pillText, isActive && buttonStyles.pillTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}
