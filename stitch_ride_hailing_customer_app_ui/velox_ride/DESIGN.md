---
name: Velox Ride
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#3d4947'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#6d7a77'
  outline-variant: '#bcc9c6'
  surface-tint: '#006a61'
  primary: '#00685f'
  on-primary: '#ffffff'
  primary-container: '#008378'
  on-primary-container: '#f4fffc'
  inverse-primary: '#6bd8cb'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#006b2d'
  on-tertiary: '#ffffff'
  tertiary-container: '#00873a'
  on-tertiary-container: '#f7fff2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#89f5e7'
  primary-fixed-dim: '#6bd8cb'
  on-primary-fixed: '#00201d'
  on-primary-fixed-variant: '#005049'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#71fe91'
  tertiary-fixed-dim: '#52e078'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#005321'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  title-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: 0em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.25rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 1.75rem
---

## Brand & Style

The design system embodies modern urban mobility: ultra-fast, dependable, and effortlessly precise. Designed for urban commuters, business travelers, and late-night riders, the visual language balances utilitarian speed with a quiet, high-end automotive poise.

The design movement combines **Minimalism** with focused **Tactile Precision**:
- High-density information hierarchy prioritizing glanceability, spatial navigation, and immediate status recognition.
- Ultra-clean canvas surfaces layered over dynamic, high-contrast map backgrounds.
- Intentional physical metaphors: floating tactile pill tabs, mechanical route-progress needles, and distinct bottom-sheet physical anchors.
- Crisp transitions and micro-interactions delivering a feeling of kinetic efficiency and mechanical precision.

## Colors

The palette leverages an electric yet grounded teal primary against deep structural slate neutrals, accented by clear situational semantics.

### Functional Mapping & Tokens
- **Primary Teal (`#0D9488`)**: Primary action buttons, active navigation pathing, primary pin headers, and en-route states.
- **Secondary Slate (`#0F172A`)**: Critical headlines, vehicle silhouette fills, map route lines, and deep dark-mode base shells.
- **Vibrant Accent Green (`#00B14F`)**: Ride confirmed state, completed receipts, discount callouts, and driver location tracking pulse.
- **Neutral Slate (`#64748B`)**: Secondary subtitles, inactive route trajectories, divider borders, and placeholder text.
- **Semantic Badges**:
  - *Searching / Pending*: Warm Amber (`#F59E0B`, surface `#FEF3C7`).
  - *En-Route / Approaching*: Deep Teal (`#0D9488`, surface `#CCFBF1`).
  - *Completed / Settled*: Bright Emerald (`#10B981`, surface `#D1FAE5`).
  - *Cancelled / Alert*: Urgent Rose (`#F43F5E`, surface `#FFE4E6`).
- **Canvas & Surface Levels**:
  - `surface-canvas`: `#F8FAFC` (Mobile app substrate).
  - `surface-card`: `#FFFFFF` (Floating sheets, cards, popovers).
  - `surface-raised`: `#F1F5F9` (Search inputs, route waypoints, segment trackers).

## Typography

The typography uses Inter across all roles to achieve the crisp, programmatic clarity found in native iOS and Android mobility suites.

### Typographic Hierarchy Rules
- **Numerical Glanceability**: ETA timers, fare amounts, and license plate tags must always use tabular figures (`font-feature-settings: "tnum"`) with bold weights (`600` or `700`).
- **Destination Waypoints**: Input titles use `headline-sm` with zero margin beneath them to sustain tight structural relationship with pickup/drop-off icons.
- **Badges and Pills**: Use `label-sm` or `label-md` exclusively in uppercase or strong capitalization, tracking out by +0.02em to +0.04em for immediate recognition against bright fills.

## Layout & Spacing

The system utilizes a bottom-anchored, fluid single-column layout optimized for single-hand mobile interactions.

### Architecture & Spatial Rhythm
- **Map Viewport (Canvas)**: Extends 100% full-bleed behind system bars, navigation, and sheets.
- **Draggable Modal Bottom Sheet**: Anchored to the viewport bottom with safe-area insets (`env(safe-area-inset-bottom)`). Houses core flows: Ride Discovery, Tier Selection, Driver Tracking, and Receipt.
- **Floating Controls**: Recenter button, SOS widget, and back arrows float over the map layer using `margin-mobile` (16px) off the outer edges, dynamically elevating above sheet snapping heights.
- **Vertical Rhythm**: A strict 4px/8px modular base rhythm guarantees that vehicle lists and route inputs maintain consistent touch targets (minimum 48px height across interactive nodes).

## Elevation & Depth

Visual hierarchy combines clean tonal surfaces, low-contrast ghost borders, and focused ambient drop shadows to cleanly decouple floating interactive controls from dense vector map artwork.

### Elevation Levels
- **Level 0 (Map Floor)**: Vector map ground plane with muted buildings and high-contrast road ribbons.
- **Level 1 (Inlaid Containers)**: Inset search containers, input backgrounds, and vehicle attribute tags (`background: #F1F5F9`, border `1px solid rgba(15, 23, 42, 0.04)`).
- **Level 2 (Cards & Tier Options)**: Floating selectable car tier options and summary modules (`box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.03)`).
- **Level 3 (Bottom Sheets & Overlays)**: Snappable ride sheets (`box-shadow: 0 -8px 28px -6px rgba(15, 23, 42, 0.12), 0 -2px 8px -2px rgba(15, 23, 42, 0.04)`).
- **Level 4 (Floating Action Buttons & Driver Alerts)**: Circular map tools and emergency overlays (`box-shadow: 0 10px 25px -5px rgba(13, 148, 136, 0.25), 0 8px 10px -6px rgba(15, 23, 42, 0.1)`).
- **Ghost Outlines**: Every elevated card and sheet features an ultra-subtle border (`1px solid rgba(15, 23, 42, 0.08)`) to maintain visual crispness in sunny, high-glare environments.

## Shapes

The system relies on pill-shaped gestures and oversized curves to create an ergonomic, thumb-friendly touch environment.

### Geometry Specifications
- **Bottom Sheets**: `rounded-3xl` (24px to 28px) on top-left and top-right radii; flat on the bottom edge conforming to viewport bounds. The grab handle is a 36px wide by 4px high pill with a 9999px radius.
- **Vehicle Tier Pills & CTAs**: Fully rounded pill capsules (`border-radius: 9999px`) for quick-switch selector tabs, quick filters ("Now", "Reserve", "Work"), and the main "Confirm Ride" CTA button.
- **Cards & Input Groups**: `rounded-2xl` (16px to 20px) ensuring fluid containment without sharp visual interruptions.
- **Waypoint Indicators**: Circular dot metaphors—8px solid `#0D9488` for pickup point, 8px solid `#0F172A` with an outer square contour for destination.

## Components

### Buttons
- **Primary CTA ("Confirm Ride", "Book Now")**: Full-width, 56px height, pill-shaped (`rounded-full`), background `#0D9488`, label `label-lg` in crisp `#FFFFFF`. Active press scale: `transform: scale(0.98)`.
- **Secondary Action**: 48px height, outline style with `1.5px solid #E2E8F0`, background `#FFFFFF`, text `#0F172A`.
- **Floating Map Buttons (Recenter, Safety, Compass)**: 44px × 44px circular white disks (`#FFFFFF`), housing 20px monochrome icons in `#0F172A`, elevated at Level 4.

### Vehicle Tier Selector
- Horizontal scroll card collection. Each card is structured with:
  - Container: 104px width, 120px height, `rounded-2xl`, background `#FFFFFF`, border `1.5px solid #F1F5F9`.
  - Selected State: Border `2px solid #0D9488`, surface tint `#F0FDFA`.
  - Content: 3D rendered isometric vehicle asset (top), ride tier title (`label-md`), ETA (`body-sm`), and fare locked in tabular figures (`title-md`).

### Streamlined Waypoint Input Fields
- A unified stacked container with `rounded-2xl`, surface `#F8FAFC`, and border `1px solid #E2E8F0`.
- Visual connector: Left margin contains an 8px emerald circle (pickup), a vertical 2px dashed connector line (`#CBD5E1`), and an 8px dark slate square (destination).
- Inputs: Frameless text inputs (`16px`, Inter, `font-weight: 500`) separated by a hairline 1px divider, with dedicated "Add Stop" (+) and "Clear" cross actions.

### Status Badges & Chips
- Compact pills (`padding: 4px 10px`, `border-radius: 9999px`).
- **Searching**: Surface `#FEF3C7`, text `#D97706`, label `label-sm`, animated pulse indicator dot.
- **En-Route**: Surface `#CCFBF1`, text `#0F766E`, ETA countdown attached.
- **Completed**: Surface `#D1FAE5`, text `#065F46`.
- **Cancelled**: Surface `#FFE4E6`, text `#BE123C`.

### Bottom Navigation & Sheet Dock
- Translucent backdrop blur (`backdrop-filter: blur(16px); background: rgba(255, 255, 255, 0.92)`).
- Three core destinations: *Ride*, *Activity*, *Account*. Active item denoted by a solid `#0D9488` icon and a 4px dot below the label.