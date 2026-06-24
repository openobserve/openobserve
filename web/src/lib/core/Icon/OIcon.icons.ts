// ─────────────────────────────────────────────────────────────────────────────
// APPROVED ICON REGISTRY
//
// Icons are resolved at build time by unplugin-icons — zero runtime fetches, so the
// app stays functional in air-gapped environments.
//
// Sourced from Hugeicons (primary, thin + rounded, stroke 1.5) with Streamline-Flex
// as a gap fallback. IconName is a closed literal union derived from this registry —
// unknown names are TypeScript compile errors, not runtime errors.
// ─────────────────────────────────────────────────────────────────────────────

import type { Component } from "vue";

import HuActivity01 from "~icons/hugeicons/activity-01";
import HuAdd01 from "~icons/hugeicons/add-01";
import HuAddCircle from "~icons/hugeicons/add-circle";
import HuAddTeam from "~icons/hugeicons/add-team";
import HuAiBrain01 from "~icons/hugeicons/ai-brain-01";
import HuAlarmClock from "~icons/hugeicons/alarm-clock";
import HuAlert02 from "~icons/hugeicons/alert-02";
import HuAlertCircle from "~icons/hugeicons/alert-circle";
import HuAnalytics01 from "~icons/hugeicons/analytics-01";
import HuApi from "~icons/hugeicons/api";
import HuArrowDataTransferHorizontal from "~icons/hugeicons/arrow-data-transfer-horizontal";
import HuArrowDown01 from "~icons/hugeicons/arrow-down-01";
import HuArrowDown02 from "~icons/hugeicons/arrow-down-02";
import HuArrowDownLeft01 from "~icons/hugeicons/arrow-down-left-01";
import HuArrowExpand01 from "~icons/hugeicons/arrow-expand-01";
import HuArrowLeft01 from "~icons/hugeicons/arrow-left-01";
import HuArrowLeft02 from "~icons/hugeicons/arrow-left-02";
import HuArrowLeftDouble from "~icons/hugeicons/arrow-left-double";
import HuArrowReloadHorizontal from "~icons/hugeicons/arrow-reload-horizontal";
import HuArrowRight01 from "~icons/hugeicons/arrow-right-01";
import HuArrowRight02 from "~icons/hugeicons/arrow-right-02";
import HuArrowRightDouble from "~icons/hugeicons/arrow-right-double";
import HuArrowShrink01 from "~icons/hugeicons/arrow-shrink-01";
import HuArrowTurnBackward from "~icons/hugeicons/arrow-turn-backward";
import HuArrowTurnForward from "~icons/hugeicons/arrow-turn-forward";
import HuArrowUp01 from "~icons/hugeicons/arrow-up-01";
import HuArrowUp02 from "~icons/hugeicons/arrow-up-02";
import HuArrowUpRight01 from "~icons/hugeicons/arrow-up-right-01";
import HuAttachment01 from "~icons/hugeicons/attachment-01";
import HuBackpack01 from "~icons/hugeicons/backpack-01";
import HuBackward01 from "~icons/hugeicons/backward-01";
import HuBackward02 from "~icons/hugeicons/backward-02";
import HuBank from "~icons/hugeicons/bank";
import HuBookmark01 from "~icons/hugeicons/bookmark-01";
import HuBookOpen01 from "~icons/hugeicons/book-open-01";
import HuBrain01 from "~icons/hugeicons/brain-01";
import HuBrowser from "~icons/hugeicons/browser";
import HuBubbleChat from "~icons/hugeicons/bubble-chat";
import HuBubbleChatQuestion from "~icons/hugeicons/bubble-chat-question";
import HuBuilding06 from "~icons/hugeicons/building-06";
import HuCalendar01 from "~icons/hugeicons/calendar-01";
import HuCalendar03 from "~icons/hugeicons/calendar-03";
import HuCancel01 from "~icons/hugeicons/cancel-01";
import HuCancelCircle from "~icons/hugeicons/cancel-circle";
import HuChartColumn from "~icons/hugeicons/chart-column";
import HuChartDecrease from "~icons/hugeicons/chart-decrease";
import HuChartGantt from "~icons/hugeicons/chart-gantt";
import HuChartIncrease from "~icons/hugeicons/chart-increase";
import HuChartLineData01 from "~icons/hugeicons/chart-line-data-01";
import HuCheckmarkBadge01 from "~icons/hugeicons/checkmark-badge-01";
import HuCheckmarkCircle01 from "~icons/hugeicons/checkmark-circle-01";
import HuCheckmarkCircle02 from "~icons/hugeicons/checkmark-circle-02";
import HuCheckmarkSquare01 from "~icons/hugeicons/checkmark-square-01";
import HuCircle from "~icons/hugeicons/circle";
import HuClock01 from "~icons/hugeicons/clock-01";
import HuCloud from "~icons/hugeicons/cloud";
import HuCloudDownload from "~icons/hugeicons/cloud-download";
import HuCloudSavingDone01 from "~icons/hugeicons/cloud-saving-done-01";
import HuCloudUpload from "~icons/hugeicons/cloud-upload";
import HuCode from "~icons/hugeicons/code";
import HuColorPicker from "~icons/hugeicons/color-picker";
import HuComputer from "~icons/hugeicons/computer";
import HuComputerPhoneSync from "~icons/hugeicons/computer-phone-sync";
import HuConnect from "~icons/hugeicons/connect";
import HuCopy01 from "~icons/hugeicons/copy-01";
import HuCreditCard from "~icons/hugeicons/credit-card";
import HuCube from "~icons/hugeicons/cube";
import HuCursorMagicSelection01 from "~icons/hugeicons/cursor-magic-selection-01";
import HuDashboardSpeed01 from "~icons/hugeicons/dashboard-speed-01";
import HuDashboardSquare01 from "~icons/hugeicons/dashboard-square-01";
import HuDashboardSquareAdd from "~icons/hugeicons/dashboard-square-add";
import HuDashedLine02 from "~icons/hugeicons/dashed-line-02";
import HuDatabase from "~icons/hugeicons/database";
import HuDatabase01 from "~icons/hugeicons/database-01";
import HuDatabaseAdd from "~icons/hugeicons/database-add";
import HuDatabaseSetting from "~icons/hugeicons/database-setting";
import HuDelete02 from "~icons/hugeicons/delete-02";
import HuDelete03 from "~icons/hugeicons/delete-03";
import HuDollar01 from "~icons/hugeicons/dollar-01";
import HuDollarCircle from "~icons/hugeicons/dollar-circle";
import HuDownload01 from "~icons/hugeicons/download-01";
import HuDragDrop from "~icons/hugeicons/drag-drop";
import HuExchange01 from "~icons/hugeicons/exchange-01";
import HuExchange02 from "~icons/hugeicons/exchange-02";
import HuFavourite from "~icons/hugeicons/favourite";
import HuFileAdd from "~icons/hugeicons/file-add";
import HuFileDownload from "~icons/hugeicons/file-download";
import HuFileEdit from "~icons/hugeicons/file-edit";
import HuFileImport from "~icons/hugeicons/file-import";
import HuFileSearch from "~icons/hugeicons/file-search";
import HuFileUpload from "~icons/hugeicons/file-upload";
import HuFilter from "~icons/hugeicons/filter";
import HuFilterHorizontal from "~icons/hugeicons/filter-horizontal";
import HuFire from "~icons/hugeicons/fire";
import HuFirstAidKit from "~icons/hugeicons/first-aid-kit";
import HuFlag02 from "~icons/hugeicons/flag-02";
import HuFlash from "~icons/hugeicons/flash";
import HuFloppyDisk from "~icons/hugeicons/floppy-disk";
import HuFlowchart01 from "~icons/hugeicons/flowchart-01";
import HuFolder01 from "~icons/hugeicons/folder-01";
import HuFolderExport from "~icons/hugeicons/folder-export";
import HuFolderOpen from "~icons/hugeicons/folder-open";
import HuForward01 from "~icons/hugeicons/forward-01";
import HuForward02 from "~icons/hugeicons/forward-02";
import HuFunction from "~icons/hugeicons/function";
import HuGift from "~icons/hugeicons/gift";
import HuGitBranch from "~icons/hugeicons/git-branch";
import HuGitFork from "~icons/hugeicons/git-fork";
import HuGitMerge from "~icons/hugeicons/git-merge";
import HuGlobal from "~icons/hugeicons/global";
import HuGlobe from "~icons/hugeicons/globe";
import HuGrid from "~icons/hugeicons/grid";
import HuGridTable from "~icons/hugeicons/grid-table";
import HuHeartCheck from "~icons/hugeicons/heart-check";
import HuHelpCircle from "~icons/hugeicons/help-circle";
import HuHome01 from "~icons/hugeicons/home-01";
import HuId from "~icons/hugeicons/id";
import HuIdea01 from "~icons/hugeicons/idea-01";
import HuImage01 from "~icons/hugeicons/image-01";
import HuInbox from "~icons/hugeicons/inbox";
import HuInfinity01 from "~icons/hugeicons/infinity-01";
import HuInformationCircle from "~icons/hugeicons/information-circle";
import HuKey01 from "~icons/hugeicons/key-01";
import HuLayers01 from "~icons/hugeicons/layers-01";
import HuLayout3Column from "~icons/hugeicons/layout-3-column";
import HuLeftToRightListBullet from "~icons/hugeicons/left-to-right-list-bullet";
import HuLeftToRightListNumber from "~icons/hugeicons/left-to-right-list-number";
import HuLicense from "~icons/hugeicons/license";
import HuLink02 from "~icons/hugeicons/link-02";
import HuLinkSquare02 from "~icons/hugeicons/link-square-02";
import HuLoading03 from "~icons/hugeicons/loading-03";
import HuLocation01 from "~icons/hugeicons/location-01";
import HuLocationUser01 from "~icons/hugeicons/location-user-01";
import HuLogin01 from "~icons/hugeicons/login-01";
import HuLogin03 from "~icons/hugeicons/login-03";
import HuLogout01 from "~icons/hugeicons/logout-01";
import HuMail01 from "~icons/hugeicons/mail-01";
import HuMedal01 from "~icons/hugeicons/medal-01";
import HuMegaphone01 from "~icons/hugeicons/megaphone-01";
import HuMenu01 from "~icons/hugeicons/menu-01";
import HuMoon02 from "~icons/hugeicons/moon-02";
import HuMoreHorizontal from "~icons/hugeicons/more-horizontal";
import HuMoreVertical from "~icons/hugeicons/more-vertical";
import HuMouse01 from "~icons/hugeicons/mouse-01";
import HuNavigation from "~icons/hugeicons/navigation";
import HuNews from "~icons/hugeicons/news";
import HuNotification02 from "~icons/hugeicons/notification-02";
import HuOffice from "~icons/hugeicons/office";
import HuPackage from "~icons/hugeicons/package";
import HuPaintBoard from "~icons/hugeicons/paint-board";
import HuPause from "~icons/hugeicons/pause";
import HuPauseCircle from "~icons/hugeicons/pause-circle";
import HuPencilEdit02 from "~icons/hugeicons/pencil-edit-02";
import HuPieChart from "~icons/hugeicons/pie-chart";
import HuPlay from "~icons/hugeicons/play";
import HuPlayCircle from "~icons/hugeicons/play-circle";
import HuPreferenceHorizontal from "~icons/hugeicons/preference-horizontal";
import HuPrinter from "~icons/hugeicons/printer";
import HuRadar01 from "~icons/hugeicons/radar-01";
import HuRadio from "~icons/hugeicons/radio";
import HuRecord from "~icons/hugeicons/record";
import HuRemove01 from "~icons/hugeicons/remove-01";
import HuReplay from "~icons/hugeicons/replay";
import HuRobot01 from "~icons/hugeicons/robot-01";
import HuRocket01 from "~icons/hugeicons/rocket-01";
import HuRoute01 from "~icons/hugeicons/route-01";
import HuSad01 from "~icons/hugeicons/sad-01";
import HuSearch01 from "~icons/hugeicons/search-01";
import HuSearch02 from "~icons/hugeicons/search-02";
import HuSearchAdd from "~icons/hugeicons/search-add";
import HuSearchRemove from "~icons/hugeicons/search-remove";
import HuSent02 from "~icons/hugeicons/sent-02";
import HuServerStack01 from "~icons/hugeicons/server-stack-01";
import HuSettings01 from "~icons/hugeicons/settings-01";
import HuShare08 from "~icons/hugeicons/share-08";
import HuShield01 from "~icons/hugeicons/shield-01";
import HuShieldEnergy from "~icons/hugeicons/shield-energy";
import HuShieldUser from "~icons/hugeicons/shield-user";
import HuSidebarLeft01 from "~icons/hugeicons/sidebar-left-01";
import HuSourceCode from "~icons/hugeicons/source-code";
import HuSourceCodeCircle from "~icons/hugeicons/source-code-circle";
import HuSparkles from "~icons/hugeicons/sparkles";
import HuSquareLock01 from "~icons/hugeicons/square-lock-01";
import HuStar from "~icons/hugeicons/star";
import HuStop from "~icons/hugeicons/stop";
import HuStopCircle from "~icons/hugeicons/stop-circle";
import HuStructure01 from "~icons/hugeicons/structure-01";
import HuSun03 from "~icons/hugeicons/sun-03";
import HuTable01 from "~icons/hugeicons/table-01";
import HuTag01 from "~icons/hugeicons/tag-01";
import HuTask01 from "~icons/hugeicons/task-01";
import HuTaskDone01 from "~icons/hugeicons/task-done-01";
import HuText from "~icons/hugeicons/text";
import HuTextAlignLeft from "~icons/hugeicons/text-align-left";
import HuTextWrap from "~icons/hugeicons/text-wrap";
import HuThumbsDown from "~icons/hugeicons/thumbs-down";
import HuThumbsUp from "~icons/hugeicons/thumbs-up";
import HuTick01 from "~icons/hugeicons/tick-01";
import HuTime04 from "~icons/hugeicons/time-04";
import HuTimeline from "~icons/hugeicons/timeline";
import HuToggleOff from "~icons/hugeicons/toggle-off";
import HuTouch01 from "~icons/hugeicons/touch-01";
import HuUnavailable from "~icons/hugeicons/unavailable";
import HuUnfoldLess from "~icons/hugeicons/unfold-less";
import HuUnfoldMore from "~icons/hugeicons/unfold-more";
import HuUpload01 from "~icons/hugeicons/upload-01";
import HuUser from "~icons/hugeicons/user";
import HuUserAdd01 from "~icons/hugeicons/user-add-01";
import HuUserCheck01 from "~icons/hugeicons/user-check-01";
import HuUserGroup from "~icons/hugeicons/user-group";
import HuUserMultiple from "~icons/hugeicons/user-multiple";
import HuUserSettings01 from "~icons/hugeicons/user-settings-01";
import HuView from "~icons/hugeicons/view";
import HuViewOff from "~icons/hugeicons/view-off";
import HuVolumeHigh from "~icons/hugeicons/volume-high";
import HuVolumeMute02 from "~icons/hugeicons/volume-mute-02";
import HuWifi01 from "~icons/hugeicons/wifi-01";
import HuWifiConnected01 from "~icons/hugeicons/wifi-connected-01";
import HuWrench01 from "~icons/hugeicons/wrench-01";
import Ms123 from "~icons/material-symbols/123";
import MsClockLoader20 from "~icons/material-symbols/clock-loader-20";
import MsJavascript from "~icons/material-symbols/javascript";
import MsPets from "~icons/material-symbols/pets";
import MsReceiptLongOutline from "~icons/material-symbols/receipt-long-outline";
import MsSoundSampler from "~icons/material-symbols/sound-sampler";

export const iconRegistry = {
  "alarm": HuAlarmClock,
  "add": HuAdd01,
  "arrow-back": HuArrowLeft02,
  "arrow-back-ios-new": HuArrowLeft01,
  "arrow-downward": HuArrowDown02,
  "arrow-drop-down": HuArrowDown01,
  "arrow-drop-up": HuArrowUp01,
  "arrow-forward": HuArrowRight02,
  "arrow-upward": HuArrowUp02,
  "article": HuNews,
  "attachment": HuAttachment01,
  "stars": HuSparkles,
  "favorite": HuFavourite,
  "favorite-border": HuFavourite,
  "backpack": HuBackpack01,
  "block": HuUnavailable,
  "bolt": HuFlash,
  "cached": HuArrowReloadHorizontal,
  "calendar-month": HuCalendar01,
  "campaign": HuMegaphone01,
  "cancel": HuCancelCircle,
  "redeem": HuGift,
  "receipt-long": MsReceiptLongOutline,
  "category": HuGrid,
  "check": HuTick01,
  "check-circle": HuCheckmarkCircle01,
  "chevron-left": HuArrowLeft01,
  "backup": HuCloudUpload,
  "chevron-right": HuArrowRight01,
  "close": HuCancel01,
  "cloud": HuCloud,
  "code": HuSourceCode,
  "compare-arrows": HuExchange01,
  "content-copy": HuCopy01,
  "delete": HuDelete02,
  "download": HuDownload01,
  "edit": HuPencilEdit02,
  "error": HuAlertCircle,
  "error-outline": HuAlertCircle,
  "event": HuCalendar01,
  "expand-more": HuArrowDown01,
  "upload-file": HuFileUpload,
  "format-list-bulleted": HuLeftToRightListBullet,
  "fullscreen": HuArrowExpand01,
  "group-work": HuUserGroup,
  "group-add": HuAddTeam,
  "groups": HuUserGroup,
  "how-to-reg": HuUserCheck01,
  "help-outline": HuHelpCircle,
  "history": HuClock01,
  "info": HuInformationCircle,
  "info-filled": HuInformationCircle,
  "info-outline": HuInformationCircle,
  "account-balance": HuBank,
  "account-tree": HuStructure01,
  "dark-mode": HuMoon02,
  "draft": HuFileEdit,
  "drive-file-move": HuFolderExport,
  "expand-less": HuArrowUp01,
  "inventory-2": HuPackage,
  "light-mode": HuSun03,
  "schema": HuStructure01,
  "wifi": HuWifi01,
  "window": HuBrowser,
  "javascript": MsJavascript,
  "keyboard-arrow-down": HuArrowDown01,
  "keyboard-double-arrow-left": HuArrowLeftDouble,
  "keyboard-double-arrow-right": HuArrowRightDouble,
  "language": HuGlobe,
  "link": HuLink02,
  "location-on": HuLocation01,
  "more-vert": HuMoreVertical,
  "menu": HuMenu01,
  "open-in-new": HuLinkSquare02,
  "organization": HuBuilding06,
  "pause": HuPause,
  "pause-circle-filled": HuPauseCircle,
  "person": HuUser,
  "person-add": HuUserAdd01,
  "play-arrow": HuPlay,
  "preview": HuView,
  "query-stats": HuChartLineData01,
  "refresh": HuArrowReloadHorizontal,
  "replay": HuReplay,
  "replay-10": HuBackward01,
  "forward-10": HuForward01,
  "schedule": HuClock01,
  "search": HuSearch01,
  "send": HuSent02,
  "share": HuShare08,
  "settings": HuSettings01,
  "shield": HuShield01,
  "show-chart": HuChartLineData01,
  "timeline": HuTimeline,
  "tune": HuPreferenceHorizontal,
  "visibility": HuView,
  "visibility-off": HuViewOff,
  "warning": HuAlert02,
  "workspaces": HuGrid,
  "workspace-premium": HuMedal01,
  "unfold-less": HuUnfoldLess,
  "left-panel-close": HuSidebarLeft01,
  "left-panel-open": HuSidebarLeft01,
  "reorder": HuMenu01,
  "first-page": HuArrowLeftDouble,
  "last-page": HuArrowRightDouble,
  "dashboard": HuDashboardSquare01,
  "access-time": HuClock01,
  "activity": HuActivity01,
  "align-left": HuTextAlignLeft,
  "all-inclusive": HuInfinity01,
  "assignment-turned-in": HuTaskDone01,
  "auto-awesome": HuSparkles,
  "bar-chart": HuChartColumn,
  "bookmark": HuBookmark01,
  "build": HuWrench01,
  "business": HuBuilding06,
  "chat": HuBubbleChat,
  "check-box": HuCheckmarkSquare01,
  "close-fullscreen": HuArrowShrink01,
  "data-object": HuSourceCode,
  "database": HuDatabase,
  "description": HuLicense,
  "dns": HuServerStack01,
  "fork-right": HuGitFork,
  "git-branch": HuGitBranch,
  "graph-2": HuFlowchart01,
  "flame": HuFire,
  "whatshot": HuFire,
  "brain-circuit": HuAiBrain01,
  "key": HuKey01,
  "admin-panel-settings": HuShieldUser,
  "fact-check": HuTaskDone01,
  "alt-route": HuRoute01,
  "emergency": HuFirstAidKit,
  "compress": HuArrowShrink01,
  "pattern": HuDashedLine02,
  "call-merge": HuGitMerge,
  "auto-graph": HuChartLineData01,
  "play-circle-filled": HuPlayCircle,
  "pets": MsPets,
  "monitor-heart": HuHeartCheck,
  "dataset": HuTable01,
  "folder-open": HuFolderOpen,
  "folder": HuFolder01,
  "folder-outline": HuFolder01,
  "widgets": HuDashboardSquare01,
  "lan": HuStructure01,
  "trending-up-filled": HuChartIncrease,
  "view-in-ar": HuCube,
  "input": HuLogin03,
  "transform": HuArrowDataTransferHorizontal,
  "processing": HuArrowDataTransferHorizontal,
  "navigate-before": HuArrowLeft01,
  "navigate-next": HuArrowRight01,
  "fullscreen-exit": HuArrowShrink01,
  "group": HuUserMultiple,
  "hourglass-empty": HuTime04,
  "label": HuTag01,
  "layers": HuLayers01,
  "mail": HuMail01,
  "manage-search": HuSearch01,
  "merge": HuGitMerge,
  "more-horiz": HuMoreHorizontal,
  "navigation": HuNavigation,
  "notifications": HuNotification02,
  "open-in-full": HuArrowExpand01,
  "play-circle": HuPlayCircle,
  "smart-toy": HuRobot01,
  "speed": HuDashboardSpeed01,
  "stop-circle": HuStopCircle,
  "storage": HuDatabase01,
  "table-chart": HuTable01,
  "timer": HuClock01,
  "title": HuText,
  "trending-up": HuChartIncrease,
  "undo": HuArrowTurnBackward,
  "unfold-more": HuUnfoldMore,
  "upload": HuUpload01,
  "verified-user": HuShieldUser,
  "webhook": HuApi,
  "menu-book": HuBookOpen01,
  "add-circle": HuAddCircle,
  "add-circle-outline": HuAddCircle,
  "ads-click": HuCursorMagicSelection01,
  "analytics": HuAnalytics01,
  "arrow-back-ios": HuArrowLeft01,
  "arrow-forward-ios": HuArrowRight01,
  "arrow-right": HuArrowRight02,
  "arrow-right-alt": HuArrowRight02,
  "assessment": HuAnalytics01,
  "assignment": HuTask01,
  "attach-file": HuAttachment01,
  "attach-money": HuDollar01,
  "sound-sampler": MsSoundSampler,
  "clock-loader-20": MsClockLoader20,
  "data-info-alert": HuDatabaseSetting,
  "function": HuFunction,
  "list": HuMenu01,
  "123": Ms123,
  "paid": HuDollarCircle,
  "autorenew": HuArrowReloadHorizontal,
  "progress-activity": HuLoading03,
  "card-giftcard": HuGift,
  "check-circle-outline": HuCheckmarkCircle02,
  "circle": HuCircle,
  "clear": HuCancel01,
  "cloud-done": HuCloudSavingDone01,
  "cloud-upload": HuCloudUpload,
  "code-off": HuSourceCodeCircle,
  "color-lens": HuPaintBoard,
  "colorize": HuColorPicker,
  "compare": HuExchange01,
  "corporate-fare": HuOffice,
  "dashboard-customize": HuDashboardSquareAdd,
  "data-usage": HuPieChart,
  "delete-outline": HuDelete02,
  "delete-sweep": HuDelete03,
  "devices": HuComputerPhoneSync,
  "drag-indicator": HuDragDrop,
  "event-note": HuCalendar03,
  "exit-to-app": HuLogout01,
  "expand-all": HuUnfoldMore,
  "fast-forward": HuForward02,
  "fast-rewind": HuBackward02,
  "fiber-manual-record": HuRecord,
  "file-download": HuFileDownload,
  "file-upload": HuFileUpload,
  "filter-alt": HuFilter,
  "data-plus-line": HuDatabaseAdd,
  "filter-list": HuFilterHorizontal,
  "flag": HuFlag02,
  "format-list-numbered": HuLeftToRightListNumber,
  "forum": HuBubbleChatQuestion,
  "functions": HuFunction,
  "grid-on": HuGridTable,
  "help": HuHelpCircle,
  "history-toggle-off": HuClock01,
  "home": HuHome01,
  "hub": HuConnect,
  "image": HuImage01,
  "insights": HuChartLineData01,
  "keyboard-arrow-right": HuArrowRight01,
  "keyboard-arrow-up": HuArrowUp01,
  "lightbulb": HuIdea01,
  "lightbulb-outline": HuIdea01,
  "lock": HuSquareLock01,
  "login": HuLogin01,
  "logout": HuLogout01,
  "manage-accounts": HuUserSettings01,
  "memory": HuComputer,
  "monetization-on": HuDollarCircle,
  "note-add": HuFileAdd,
  "notifications-active": HuNotification02,
  "palette": HuPaintBoard,
  "payments": HuCreditCard,
  "print": HuPrinter,
  "psychology": HuBrain01,
  "radar": HuRadar01,
  "remove": HuRemove01,
  "report-problem": HuAlert02,
  "shield-alert-outline": HuShieldEnergy,
  "restart-alt": HuArrowReloadHorizontal,
  "rocket-launch": HuRocket01,
  "rule": HuTask01,
  "running-with-errors": HuAlertCircle,
  "save": HuFloppyDisk,
  "saved-search": HuSearchAdd,
  "search-off": HuSearchRemove,
  "security": HuShield01,
  "sentiment-very-dissatisfied": HuSad01,
  "stop": HuStop,
  "swap-horiz": HuExchange01,
  "swap-vert": HuExchange02,
  "sync": HuArrowReloadHorizontal,
  "sync-disabled": HuArrowReloadHorizontal,
  "sync-problem": HuArrowReloadHorizontal,
  "table-view": HuTable01,
  "tag": HuTag01,
  "task-alt": HuCheckmarkCircle01,
  "text-fields": HuText,
  "thumb-down-off-alt": HuThumbsDown,
  "thumb-up-off-alt": HuThumbsUp,
  "person-pin-circle": HuLocationUser01,
  "toggle-off": HuToggleOff,
  "trending-down": HuChartDecrease,
  "troubleshoot": HuSearch02,
  "update": HuArrowReloadHorizontal,
  "verified": HuCheckmarkBadge01,
  "view-column": HuLayout3Column,
  "volume-off": HuVolumeMute02,
  "volume-up": HuVolumeHigh,
  "warning-amber": HuAlert02,
  "wrap-text": HuTextWrap,
  "radio-button-unchecked": HuCircle,
  "radio-button-checked": HuRadio,
  "touch-app": HuTouch01,
  "network-check": HuWifiConnected01,
  "cloud-download": HuCloudDownload,
  "call-made": HuArrowUpRight01,
  "call-received": HuArrowDownLeft01,
  "inbox": HuInbox,
  "star-rate": HuStar,
  "card-membership": HuId,
  "domain": HuBuilding06,
  "data-array": HuCode,
  "mouse": HuMouse01,
  "plagiarism": HuFileSearch,
  "redo": HuArrowTurnForward,
  "tab": HuBrowser,
  "web": HuGlobal,
  "action-import": HuFileImport,
  "action-move-to-folder": HuFolderExport,
  "action-duplicate": HuCopy01,
  "action-delete": HuDelete02,
  "traces": HuChartGantt,
} as const satisfies Record<string, Component>;

export type IconName = keyof typeof iconRegistry;
