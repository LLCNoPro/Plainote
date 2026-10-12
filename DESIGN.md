---
name: 素记 Plainote
description: Warm, restrained desktop writing surfaces with a manuscript-centered workspace.
colors:
  accent: "#356b59"
  accent-soft: "#e3ece4"
  surface: "#fcfaf6"
  sidebar: "#f2efe9"
  raised: "#fffdf9"
  text: "#2d3732"
  muted: "#59655c"
  line: "#e5e5dc"
  hover: "#e9e8df"
  error: "#a33c35"
  error-bg: "#f9e8e4"
  warning: "#825b23"
  warning-bg: "#f6ecd7"
  dark-accent: "#a0c6b3"
  dark-accent-soft: "#34473b"
  dark-surface: "#222925"
  dark-sidebar: "#1c231f"
  dark-raised: "#2a322d"
  dark-text: "#e2e8df"
  dark-muted: "#adb8ac"
  dark-line: "#39433b"
  dark-hover: "#303a32"
  dark-error: "#f1b0a6"
  dark-error-bg: "#482e2c"
  dark-warning: "#e4c590"
  dark-warning-bg: "#403725"
typography:
  interface:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "13px"
    fontWeight: 400
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "29px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.85
  navigation:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "11px"
    fontWeight: 400
  source:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.9
rounded:
  control: "6px"
  inline: "3px"
  summary: "4px"
  dialog: "12px"
spacing:
  compact: "4px"
  small: "8px"
  control: "10px"
  row: "12px"
  inset: "14px"
  medium: "16px"
  panel: "18px"
  section: "20px"
  toolbar: "24px"
  dialog: "25px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.interface}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  button-secondary:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text}"
    typography: "{typography.navigation}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-text:
    textColor: "{colors.accent}"
    typography: "{typography.navigation}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  button-icon:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    width: "29px"
    height: "28px"
  file-row:
    textColor: "{colors.text}"
    typography: "{typography.navigation}"
    rounded: "{rounded.control}"
    padding: "8px 9px"
  file-row-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "8px 9px"
  search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px"
  note-link:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.inline}"
    padding: "1px 4px"
  summary:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text}"
    rounded: "{rounded.summary}"
    padding: "14px 17px"
  dialog:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    width: "min(600px, calc(100vw - 40px))"
---

# Design System: 素记 Plainote

## Overview

**Creative North Star: "文稿居中"**

The confirmed identity is 温润素雅: warm white, ink-colored text, and a small amount of teal. A readable manuscript sits at the center of a compact desktop workspace. Navigation and auxiliary information support writing through quieter colors, smaller type, and thin dividers.

System Chinese sans-serif typography and platform window conventions suit the macOS and Windows product context. The documented implementation is an interactive HTML prototype: notes, settings, saving, and recovery are examples held in page memory. The visual system does not establish real local-file functionality or a final application stack.

**Key Characteristics:**
- Warm paper surfaces and restrained teal interaction states.
- Spacious manuscript, compact navigation, and collapsible auxiliary information.
- Thin borders, low-radius controls, and elevation reserved for overlays.
- Consistent inline SVG icons without shipping raster assets.

## Colors

A single teal accent sits within warm neutral surfaces; error and warning colors communicate exceptional states.

### Primary
- **Teal (`accent`)** identifies primary actions, active navigation, document links, task markers, and focus.
- **Soft teal (`accent-soft`)** grounds selected rows, pressed modes, note links, and text selection.
- Dark mode substitutes the corresponding `dark-accent` and `dark-accent-soft` tokens through the same CSS custom properties.

### Neutral
- **Warm paper (`surface`)** covers the manuscript workspace and inspector.
- **Warm gray (`sidebar`)** distinguishes navigation, window chrome, summary blocks, code backgrounds, and table headings.
- **Raised paper (`raised`)** marks active document tabs, dialogs, and selected segmented controls.
- **Ink (`text`)** carries readable content. **Muted ink (`muted`)** carries supporting information and inactive controls.
- **Fine divider (`line`)** separates workspace regions and rows. **Hover wash (`hover`)** provides ordinary pointer feedback.
- Each neutral has a corresponding `dark-` token, applied by the dark theme. Dark mode preserves the layout and component hierarchy.

Error uses `error` on `error-bg`; warnings use `warning` on `warning-bg`. These roles also have dark counterparts and do not form additional brand accents.

**The Semantic Teal Rule.** Use the accent for interaction, selection, links, and focus, following the existing components.

## Typography

**Body and interface font:** the platform sans-serif stack in the frontmatter, including Chinese fallbacks. Platform defaults are intentional for this operating interface.

**Source font:** the separate monospace stack used by the Markdown source view.

The manuscript gains prominence through scale and spacing rather than a decorative display face. Navigation stays compact without inheriting the manuscript's generous line height.

### Hierarchy
- **Title:** manuscript heading; reduced to (26px) at the intermediate breakpoint and (25px) at the small breakpoint.
- **Headline:** manuscript section headings. Dialog headings also use (19px), weight (600).
- **Body:** final default manuscript size from the stylesheet cascade; settings allow a page-local adjustment from (14px) through (20px).
- **Interface:** base controls and settings titles. Navigation rows and tabs use the smaller navigation role; selected file rows use weight (600).
- **Label:** note metadata, status controls, keyboard shortcuts, search counts, and supporting captions use the final (11px) cascade. At small widths, earlier metadata shrinking is superseded by this final override.
- **Source:** editable source uses the monospace role. Document summaries use (14px) with line height (1.85); tables and inline code use (13px).

**The Manuscript Hierarchy Rule.** Keep document headings and body larger than adjacent navigation and status information.

## Layout

The application fills the viewport (100dvh). Its grid uses a (40px) titlebar, flexible workspace, and (28px) statusbar. The workspace has a (238px) left directory, flexible center, and (242px) right inspector. The center can shrink without forcing the full window to scroll; document, file tree, tabs, search, and quick-open results own their scroll areas.

The manuscript wrapper is centered with a maximum width of (790px), including padding (40px 56px 85px). Tabs occupy (42px) and the next toolbar at least (44px). The directory uses compact rows of at least (33px). Repeated gaps and insets are represented in the spacing tokens, while manuscript margins remain intentionally larger.

- At widths up to (1150px), sidebars become (218px) and (205px); manuscript padding becomes (30px 35px 70px), and the title shrinks.
- At widths up to (1050px), the inspector is hidden by default and can be explicitly shown. The directory can still collapse independently.
- At widths up to (700px), both sidebars are hidden by default; the directory width becomes (190px), and manuscript padding becomes (25px 24px 60px). Explicit directory visibility takes precedence when both panels are requested. Breadcrumbs simplify, conflict cards stack, and the sample badge is hidden.
- The welcome state uses only the central workspace at all widths, suppressing unavailable editor status items.

## Elevation & Depth

Ordinary workspace surfaces are flat, separated by tonal differences and (1px) borders. Dialogs and toast messages use the CSS `--shadow` token: light mode (`0 18px 65px #182e2629`) and dark mode (`0 18px 65px #0007`). Dialogs use a translucent backdrop (`#1c2e2638`); the toast sits above the window at the bottom center.

**The Overlay Elevation Rule.** Keep workspace panes flat; use the existing diffuse shadow for modal and transient overlays.

## Shapes

Controls share the control radius; inline note links and code use the smaller inline radius. Summary blocks use the summary radius, and dialogs use the larger dialog radius. Tabs, dividers, search-result rows, template rows, and backlinks keep square edges where they meet adjacent items. Segmented controls and conflict-version cards use the control radius.

SVG icons normally occupy (16px), with stroke width (1.65), round caps and joins, and `currentColor`. Smaller controls use (10px–14px) variants; the welcome book icon is a larger instance. The window preview has circular platform dots, while the book mark has its own outlined silhouette. These are specialized elements, not a general shape scale.

## Components

### Buttons

Quiet controls share the control radius and inherit the interface font. Primary buttons pair accent fill with surface-colored text and darken on hover via brightness (.94). Secondary buttons use the sidebar surface; text buttons use accent text. Ordinary buttons use the hover wash. Icon buttons use muted ink and compact fixed dimensions. Disabled buttons reduce opacity to (.5) and use the default cursor.

Keyboard-visible focus on buttons, inputs, textareas, and folder summaries uses an accent outline (2px) with offset (3px). The current build suppresses that outline inside the document and quick-open input; those exceptions are implementation observations, not reusable focus guidance.

### Inputs / Fields

The search field is a surface-colored, thin-bordered container with the control radius and an inline search SVG. Its inner input is transparent and borderless; container focus changes the border to accent. Quick-open uses a larger (16px) input with a bottom divider, followed by selectable results. The source textarea is transparent and borderless with a minimum height of (600px). The settings range and task checkboxes use the accent.

### Navigation

File rows use a quiet default, hover wash, and soft teal selected state with teal text and icons. Nested folders indent rather than acquiring extra card surfaces. Document tabs use raised paper and a (2px) teal underline when active; close buttons are separate controls. Inspector tabs use the same underline language. The current outline item uses the selected wash; inactive items remain muted.

### Inline note links / Summary blocks

Note links are compact soft-teal inline chips with no default underline; hover restores an underline. Summaries are warm-gray rectangular callouts with modest rounding and manuscript-adjacent type. Table headings and inline code reuse the sidebar tone. Completed tasks become muted and struck through.

### Dialogs / Settings / Conflict versions

Native dialogs share raised paper, rounded corners, the overlay shadow, width capped at (600px), height capped at (85vh), and top margin (17vh). Standard dialogs have heading padding (22px 25px 14px) and body padding (0 25px 25px). Quick-open uses its own input/results/footer composition within the same dialog shell.

Settings use thin-divided rows and a sidebar-toned segmented control; the active segment uses raised paper and accent text. Conflict versions appear as two equal warm-gray cards with a (15px) gap and (14px) padding, stacking at the small breakpoint. Recovery actions sit at the lower right. These controls manipulate only page-memory examples.

### Notices / Toasts / Welcome

Warnings and save failures pair semantic foreground and background colors with explanatory copy and outlined recovery controls. Toasts use inverse ink/paper colors and the overlay shadow. The welcome state centers its icon, title, explanation, and primary action with an explicit prototype disclaimer.

Outline navigation scrolls smoothly except when reduced motion is requested. The reduced-motion media query also disables CSS transitions; no decorative entrance motion is implemented.

## Do's and Don'ts

### Do:
- **Do** preserve warm paper, ink, and restrained teal in both themes.
- **Do** keep the manuscript centered and let supporting panes collapse at the implemented breakpoints.
- **Do** distinguish selected, hovered, and keyboard-focused controls using their existing treatments.
- **Do** use consistent inline SVG icons and retain explicit example-data labels in prototype surfaces.

### Don't:
- **Don't** turn semantic error and warning colors into decorative accents.
- **Don't** apply overlay shadows to ordinary workspace panes.
- **Don't** present page-memory interactions as implemented local-file storage or persistent settings.
- **Don't** inherit suppressed editor/input focus outlines as a general component rule.
