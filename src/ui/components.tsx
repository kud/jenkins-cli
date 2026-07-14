import { Box, Text } from "ink"
import type { ReactNode } from "react"

interface PanelProps {
  title: string
  color: string
  focused: boolean
  width?: number
  height?: number
  flexGrow?: number
  children: ReactNode
}

// A bordered pane with a coloured title header. Border brightens and the title
// gains a ● marker when focused — the Ink equivalent of blessed's active labels.
export const Panel = ({
  title,
  color,
  focused,
  width,
  height,
  flexGrow,
  children,
}: PanelProps) => (
  <Box
    flexDirection="column"
    width={width}
    height={height}
    flexGrow={flexGrow}
    borderStyle="round"
    borderColor={focused ? color : "gray"}
    overflow="hidden"
  >
    <Text color={focused ? color : "gray"} bold>
      {focused ? `${title} ●` : title}
    </Text>
    {children}
  </Box>
)

// Full-width bottom bar: context on the left, state chips + hints on the right.
export const StatusBar = ({
  left,
  right,
  width,
}: {
  left: string
  right: string
  width: number
}) => (
  <Box
    width={width}
    borderStyle="round"
    borderColor="green"
    height={3}
    paddingX={1}
    justifyContent="space-between"
  >
    <Text wrap="truncate">{left}</Text>
    {right ? <Text wrap="truncate">{right}</Text> : null}
  </Box>
)

// A centred overlay that replaces the body (help / artifacts). Simpler and more
// robust in Ink than a floating popup, and reads the same to the user.
export const Overlay = ({
  title,
  color,
  width,
  height,
  children,
}: {
  title: string
  color: string
  width: number
  height: number
  children: ReactNode
}) => (
  <Box
    width={width}
    height={height}
    justifyContent="center"
    alignItems="center"
  >
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      width={Math.min(width - 4, 100)}
    >
      <Text color={color} bold>
        {title}
      </Text>
      {children}
    </Box>
  </Box>
)
