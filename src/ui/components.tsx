import { Box, Text } from "ink"
import chalk from "chalk"
import type { ReactNode } from "react"

// Compute the window start so the selected row stays visible (centred when possible).
export const windowStart = (
  selected: number,
  total: number,
  rows: number,
): number => {
  if (total <= rows) return 0
  const start = selected - Math.floor(rows / 2)
  return Math.max(0, Math.min(start, total - rows))
}

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

interface ScrollListProps {
  items: string[] // may contain chalk/ANSI colour codes
  selected: number
  rows: number
  width: number
  emptyText: string
}

// A vertically-windowed selectable list. Selection is shown via reverse video,
// which survives chalk-coloured item strings (colour resets don't clear [7m).
// An explicit width + overflow:hidden is what gives `truncate` a hard boundary —
// without it Ink measures the natural (content) width and long rows bleed out.
export const ScrollList = ({
  items,
  selected,
  rows,
  width,
  emptyText,
}: ScrollListProps) => {
  if (!items.length)
    return (
      <Text color="gray" wrap="truncate">
        {emptyText}
      </Text>
    )
  const start = windowStart(selected, items.length, Math.max(1, rows))
  const visible = items.slice(start, start + Math.max(1, rows))
  return (
    <Box flexDirection="column" width={width} overflow="hidden">
      {visible.map((it, i) => {
        const idx = start + i
        const line = idx === selected ? chalk.inverse(` ${it}`) : `  ${it}`
        return (
          <Text key={idx} wrap="truncate">
            {line}
          </Text>
        )
      })}
    </Box>
  )
}

// A dumb log viewport — App pre-renders the visible slice (already chalk-formatted)
// so this component only lays lines out. The explicit width + overflow:hidden is
// essential: it bounds `truncate` so wide log lines are clipped, not wrapped into
// the neighbouring panels.
export const LogView = ({
  lines,
  width,
}: {
  lines: string[]
  width: number
}) => (
  <Box flexDirection="column" width={width} overflow="hidden">
    {lines.map((l, i) => (
      <Text key={i} wrap="truncate">
        {l.length ? l : " "}
      </Text>
    ))}
  </Box>
)

// Full-width bottom bar. Content is a pre-built chalk string.
export const StatusBar = ({
  content,
  width,
}: {
  content: string
  width: number
}) => (
  <Box width={width} borderStyle="round" borderColor="green" height={3}>
    <Text wrap="truncate">{content}</Text>
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
