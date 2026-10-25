# MODLOG - Arc recon (Underhood)

Target: Arc 1.129.0.288 for Windows (MSIX TheBrowserCompany.Arc_ttt1ap7aakyb4). Purpose: spec an Electron rebuild, not patch Arc.
Arc sunsets 2026-12-22 (arc.net, read 2026-10-24); patching it has no future, so the route is reimplementation.

## Install fingerprint (observed, PowerShell listing)
- C:\Program Files\WindowsApps\TheBrowserCompany.Arc_1.129.0.288_x64__ttt1ap7aakyb4, 1440 files, 711 MB. Bash cannot read it (ACL); PowerShell can.
- Arc.exe + Arc.dll (79 MB, Swift app) + ArcCore.dll (286 MB, embedded Chromium via "ADK") + swift*.dll runtime + WinUI 3 (Microsoft.UI.Xaml).
- Feature modules as *.bundle folders: SidebarUI, StorableSidebar, CommandBar, SpaceCreation, SpaceStyleEditor, BoostsEditor, ProfilesUI,
  ImportFeature, MediaControlsFeature, Translation, ContextMenus, AuthFeature, MembershipCard, AppTray, SoftwareUpdaterClient.
- SpaceStyleEditor ships theme presets automatic/moon/sun.json and textures grain, dot-grid, denim, tweed (do not reuse; design our own).
- String counts in Arc.dll (ASCII): Boost 213, Archive 207, Easel 156, Pinned 116, Peek 33, Split View 20, Live Folder 13, Air Traffic 5, Little Arc 1.

## Local data (observed) - %LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_ttt1ap7aakyb4\LocalCache\Local\Arc
- StorableSidebar.json (version 1): sidebar.containers[] -> spaces[] {id, title, profile{default}, customInfo{iconType{emoji}, windowTheme},
  containerIDs, newContainerIDs[{pinned|unpinned}]} and items[] {id, parentID, childrenIds, title, data{tab{savedURL, savedTitle,
  timeLastActiveAt, savedMuteStatus} | itemContainer{containerType{spaceItems|topApps}} | list}}.
  Also firebaseSyncState.syncData mirrors the same items + spaceModels + orderedSpaceIDs.
- User's file: 4 spaces, 40 items (28 tabs, 9 containers, 3 lists).
- StorableWindows.json: sidebarWidth, sidebarMode, splitViewState{windowContentIDs, focusedContentID}, focusedSpaceID, stayOnTop.
- StorableArchive.json (+ dated backups), StorableSessionRestorationData.json, "User Data" = Chromium profile (bookmarks, history, passwords).
- Importer plan (inference): read StorableSidebar.json read-only, map space->Space, containers pinned/unpinned->section, itemContainer->folder,
  tab->SidebarItem; Chromium profile data via the standard Chrome importer path on "User Data".

## Sidebar file details (observed 2026-10-24, Underhood dig)
- sidebar.containers = [{global}, {spaces, topAppsContainerIDs, items}]. spaces and items are Swift-encoded dictionaries:
  flat alternating lists [id, object, id, object, ...]. Same for topAppsContainerIDs ([{default:true}, containerId, ...]).
- space.containerIDs = ["unpinned", <containerId>, "pinned", <containerId>] (alternating key/value).
- Container item: data.itemContainer.containerType = {spaceItems: {_0: spaceId}} or {topApps: ...}; its childrenIds are the
  top-level entries of that section, in order.
- Folder = data.list {} with title + childrenIds. Tab = data.tab {savedURL, savedTitle, timeLastActiveAt, savedMuteStatus}; item.title
  is the user's rename (may be null).
- space.customInfo.iconType = {emoji: <codepoint num>, emoji_v2: "<emoji string>"}.
- space.customInfo.windowTheme.primaryColorPalette.{midTone, shaded, shadedDark, tintedLight} = {red, green, blue, alpha, colorSpace};
  semanticColorPalette.appearanceBased.{light,dark}.{background, foregroundPrimary, ...}. Importer uses midTone as the space colour.
- space.profile = {default: true} or a custom profile object.

## Unknowns
- RGB range of windowTheme components (0-1 assumed, checked by the importer: values > 1 are treated as 0-255).
- Archive item schema (not needed for v1).
- Arc's Chromium "User Data" (history SQLite, bookmarks JSON) not imported in v1.
