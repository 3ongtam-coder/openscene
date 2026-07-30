import { StyleSheet, View } from 'react-native';

import { theme } from '../lib/theme';

/**
 * Transport and navigation icons, drawn from Views.
 *
 * They were emoji and glyphs — `‹`, `⏮`, `▶` — which render as whatever the
 * system font decides: on iOS `⏮` came out as a colour emoji sitting on a blue
 * rounded tile, nothing like the surrounding controls. Drawn shapes take their
 * colour from the theme, size from a prop, and look the same on both platforms.
 *
 * Triangles use the border trick rather than a vector library: it is a handful
 * of pixels of geometry and adding react-native-svg to draw four shapes would
 * cost a native dependency and a rebuild of the dev client.
 */

type IconProps = {
  readonly size?: number;
  readonly color?: string;
};

function Triangle({ size, color, pointing }: { size: number; color: string; pointing: 'left' | 'right' }) {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        backgroundColor: 'transparent',
        borderTopWidth: size / 2,
        borderBottomWidth: size / 2,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        ...(pointing === 'right'
          ? { borderLeftWidth: size * 0.86, borderLeftColor: color, borderRightWidth: 0 }
          : { borderRightWidth: size * 0.86, borderRightColor: color, borderLeftWidth: 0 })
      }}
    />
  );
}

export function PlayIcon({ size = 16, color = theme.bg }: IconProps) {
  // Nudged right by an eighth: a triangle centred on its bounding box reads as
  // left-of-centre inside a circle, which is why every play button offsets it.
  return (
    <View style={[styles.center, { marginLeft: size * 0.12 }]}>
      <Triangle size={size} color={color} pointing="right" />
    </View>
  );
}

export function PauseIcon({ size = 16, color = theme.bg }: IconProps) {
  return (
    <View style={[styles.row, { gap: size * 0.28 }]}>
      <View style={{ width: size * 0.28, height: size, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: size * 0.28, height: size, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

/** Skip to the previous edge: a bar with a triangle running into it. */
export function SkipBackIcon({ size = 14, color = theme.text }: IconProps) {
  return (
    <View style={[styles.row, { gap: size * 0.12 }]}>
      <View style={{ width: size * 0.2, height: size, backgroundColor: color, borderRadius: 1 }} />
      <Triangle size={size} color={color} pointing="left" />
    </View>
  );
}

export function SkipForwardIcon({ size = 14, color = theme.text }: IconProps) {
  return (
    <View style={[styles.row, { gap: size * 0.12 }]}>
      <Triangle size={size} color={color} pointing="right" />
      <View style={{ width: size * 0.2, height: size, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

/** A chevron, from two borders of a rotated square. */
export function ChevronLeftIcon({ size = 16, color = theme.text }: IconProps) {
  return (
    <View
      style={{
        width: size * 0.62,
        height: size * 0.62,
        borderLeftWidth: 2,
        borderBottomWidth: 2,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
        // The stroke is drawn on the corner, so the shape sits right of centre
        // until it is pulled back.
        marginLeft: size * 0.16
      }}
    />
  );
}

export function GearIcon({ size = 18, color = theme.text }: IconProps) {
  // A ring with four teeth: enough to read as settings at 18pt, where a
  // full-toothed gear turns to mush anyway.
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      {[0, 45, 90, 135].map((angle) => (
        <View
          key={angle}
          style={{
            position: 'absolute',
            width: size * 0.16,
            height: size,
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ rotate: `${angle}deg` }]
          }}
        />
      ))}
      <View
        style={{
          width: size * 0.62,
          height: size * 0.62,
          borderRadius: size * 0.31,
          borderWidth: size * 0.16,
          borderColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.26,
          height: size * 0.26,
          borderRadius: size * 0.13,
          backgroundColor: theme.bg
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' }
});
