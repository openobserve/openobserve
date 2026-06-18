// ─────────────────────────────────────────────────────────────────────────────
// APPROVED ICON REGISTRY
//
// All icons used in the application must be listed here.
// Icons are resolved at build time by unplugin-icons — zero runtime fetches.
// This keeps the application fully functional in air-gapped environments.
//
// Sourced from Mage (preferred) and Heroicons-outline, falling back to Material
// Symbols where neither set has a sensible equivalent. IconName is a closed literal
// union derived from this registry — unknown names are TypeScript compile errors.
// ─────────────────────────────────────────────────────────────────────────────

import type { Component } from "vue";

import HeAdjustmentsHorizontal from "~icons/heroicons/adjustments-horizontal";
import HeArrowsUpDown from "~icons/heroicons/arrows-up-down";
import HeArrowTrendingDown from "~icons/heroicons/arrow-trending-down";
import HeArrowTrendingUp from "~icons/heroicons/arrow-trending-up";
import HeArrowUturnLeft from "~icons/heroicons/arrow-uturn-left";
import HeArrowUturnRight from "~icons/heroicons/arrow-uturn-right";
import HeBars3 from "~icons/heroicons/bars-3";
import HeBuildingLibrary from "~icons/heroicons/building-library";
import HeBuildingOffice from "~icons/heroicons/building-office";
import HeBuildingOffice2 from "~icons/heroicons/building-office-2";
import HeCircleStack from "~icons/heroicons/circle-stack";
import HeCloud from "~icons/heroicons/cloud";
import HeCloudArrowDown from "~icons/heroicons/cloud-arrow-down";
import HeCloudArrowUp from "~icons/heroicons/cloud-arrow-up";
import HeCodeBracket from "~icons/heroicons/code-bracket";
import HeCube from "~icons/heroicons/cube";
import HeDocument from "~icons/heroicons/document";
import HeDocumentMagnifyingGlass from "~icons/heroicons/document-magnifying-glass";
import HeDocumentText from "~icons/heroicons/document-text";
import HeFaceFrown from "~icons/heroicons/face-frown";
import HeGlobeAlt from "~icons/heroicons/globe-alt";
import HeHandThumbDown from "~icons/heroicons/hand-thumb-down";
import HeHandThumbUp from "~icons/heroicons/hand-thumb-up";
import HeHome from "~icons/heroicons/home";
import HeListBullet from "~icons/heroicons/list-bullet";
import HeNoSymbol from "~icons/heroicons/no-symbol";
import HeNumberedList from "~icons/heroicons/numbered-list";
import HePaperAirplane from "~icons/heroicons/paper-airplane";
import HePauseCircle from "~icons/heroicons/pause-circle";
import HePencil from "~icons/heroicons/pencil";
import HeQueueList from "~icons/heroicons/queue-list";
import HeServerStack from "~icons/heroicons/server-stack";
import HeShare from "~icons/heroicons/share";
import HeShieldExclamation from "~icons/heroicons/shield-exclamation";
import HeSignal from "~icons/heroicons/signal";
import HeSparkles from "~icons/heroicons/sparkles";
import HeSquares2x2 from "~icons/heroicons/squares-2x2";
import HeTableCells from "~icons/heroicons/table-cells";
import HeVariable from "~icons/heroicons/variable";
import HeViewColumns from "~icons/heroicons/view-columns";
import HeWindow from "~icons/heroicons/window";
import MgAlarmClock from "~icons/mage/alarm-clock";
import MgArrowDown from "~icons/mage/arrow-down";
import MgArrowDownLeft from "~icons/mage/arrow-down-left";
import MgArrowLeft from "~icons/mage/arrow-left";
import MgArrowRight from "~icons/mage/arrow-right";
import MgArrowUp from "~icons/mage/arrow-up";
import MgArrowUpRight from "~icons/mage/arrow-up-right";
import MgAttachment from "~icons/mage/attachment";
import MgBolt from "~icons/mage/bolt";
import MgBook from "~icons/mage/book";
import MgBookmark from "~icons/mage/bookmark";
import MgBox from "~icons/mage/box";
import MgCalendar from "~icons/mage/calendar";
import MgCancel from "~icons/mage/cancel";
import MgCaretDown from "~icons/mage/caret-down";
import MgCaretUp from "~icons/mage/caret-up";
import MgChart from "~icons/mage/chart";
import MgChartUp from "~icons/mage/chart-up";
import MgChartVertical from "~icons/mage/chart-vertical";
import MgCheck from "~icons/mage/check";
import MgCheckCircle from "~icons/mage/check-circle";
import MgChecklist from "~icons/mage/checklist";
import MgChecklistNote from "~icons/mage/checklist-note";
import MgCheckSquare from "~icons/mage/check-square";
import MgChevronDown from "~icons/mage/chevron-down";
import MgChevronLeft from "~icons/mage/chevron-left";
import MgChevronRight from "~icons/mage/chevron-right";
import MgChevronUp from "~icons/mage/chevron-up";
import MgChip from "~icons/mage/chip";
import MgClipboard from "~icons/mage/clipboard";
import MgClock from "~icons/mage/clock";
import MgColorPicker from "~icons/mage/color-picker";
import MgColorSwatch from "~icons/mage/color-swatch";
import MgCopy from "~icons/mage/copy";
import MgCreditCard from "~icons/mage/credit-card";
import MgDashboard from "~icons/mage/dashboard";
import MgDashboardPlus from "~icons/mage/dashboard-plus";
import MgDatabase from "~icons/mage/database";
import MgDollar from "~icons/mage/dollar";
import MgDoubleArrowLeft from "~icons/mage/double-arrow-left";
import MgDoubleArrowRight from "~icons/mage/double-arrow-right";
import MgDownload from "~icons/mage/download";
import MgEmail from "~icons/mage/email";
import MgExchangeA from "~icons/mage/exchange-a";
import MgExchangeB from "~icons/mage/exchange-b";
import MgExclamationCircle from "~icons/mage/exclamation-circle";
import MgExclamationTriangle from "~icons/mage/exclamation-triangle";
import MgExternalLink from "~icons/mage/external-link";
import MgFastForward from "~icons/mage/fast-forward";
import MgFastForwardBack from "~icons/mage/fast-forward-back";
import MgFileDownload from "~icons/mage/file-download";
import MgFilePlus from "~icons/mage/file-plus";
import MgFileUpload from "~icons/mage/file-upload";
import MgFilter from "~icons/mage/filter";
import MgFireA from "~icons/mage/fire-a";
import MgFlag from "~icons/mage/flag";
import MgFolder from "~icons/mage/folder";
import MgFolderOpen from "~icons/mage/folder-open";
import MgGift from "~icons/mage/gift";
import MgGlobe from "~icons/mage/globe";
import MgHeart from "~icons/mage/heart";
import MgHeartHealth from "~icons/mage/heart-health";
import MgIdCard from "~icons/mage/id-card";
import MgImage from "~icons/mage/image";
import MgInbox from "~icons/mage/inbox";
import MgInformationCircle from "~icons/mage/information-circle";
import MgKey from "~icons/mage/key";
import MgLaptop from "~icons/mage/laptop";
import MgLayoutGrid from "~icons/mage/layout-grid";
import MgLightBulb from "~icons/mage/light-bulb";
import MgLink from "~icons/mage/link";
import MgLocationPin from "~icons/mage/location-pin";
import MgLock from "~icons/mage/lock";
import MgLogin from "~icons/mage/login";
import MgLogout from "~icons/mage/logout";
import MgMaximize from "~icons/mage/maximize";
import MgMegaphoneA from "~icons/mage/megaphone-a";
import MgMessage from "~icons/mage/message";
import MgMessageConversation from "~icons/mage/message-conversation";
import MgMinimize from "~icons/mage/minimize";
import MgMinus from "~icons/mage/minus";
import MgMoon from "~icons/mage/moon";
import MgMouse from "~icons/mage/mouse";
import MgMousePointer from "~icons/mage/mouse-pointer";
import MgNotificationBell from "~icons/mage/notification-bell";
import MgPause from "~icons/mage/pause";
import MgPlay from "~icons/mage/play";
import MgPlayCircle from "~icons/mage/play-circle";
import MgPlus from "~icons/mage/plus";
import MgPlusCircle from "~icons/mage/plus-circle";
import MgPreview from "~icons/mage/preview";
import MgPrinter from "~icons/mage/printer";
import MgQuestionMarkCircle from "~icons/mage/question-mark-circle";
import MgRefresh from "~icons/mage/refresh";
import MgRibbon from "~icons/mage/ribbon";
import MgRobot from "~icons/mage/robot";
import MgRocket from "~icons/mage/rocket";
import MgSaveFloppy from "~icons/mage/save-floppy";
import MgSearch from "~icons/mage/search";
import MgSecurityShield from "~icons/mage/security-shield";
import MgServer from "~icons/mage/server";
import MgSettings from "~icons/mage/settings";
import MgShare from "~icons/mage/share";
import MgShieldCheck from "~icons/mage/shield-check";
import MgStack from "~icons/mage/stack";
import MgStar from "~icons/mage/star";
import MgStarsA from "~icons/mage/stars-a";
import MgStop from "~icons/mage/stop";
import MgStopCircle from "~icons/mage/stop-circle";
import MgSun from "~icons/mage/sun";
import MgTag from "~icons/mage/tag";
import MgTrash from "~icons/mage/trash";
import MgTrash2 from "~icons/mage/trash-2";
import MgUpload from "~icons/mage/upload";
import MgUser from "~icons/mage/user";
import MgUserCheck from "~icons/mage/user-check";
import MgUserPlus from "~icons/mage/user-plus";
import MgUsers from "~icons/mage/users";
import MgVerifiedCheck from "~icons/mage/verified-check";
import MgVolumeMute from "~icons/mage/volume-mute";
import MgVolumeUp from "~icons/mage/volume-up";
import MgWifi from "~icons/mage/wifi";
import MgWrench from "~icons/mage/wrench";
import MgX from "~icons/mage/x";
import Ms123 from "~icons/material-symbols/123";
import MsAccountTreeOutline from "~icons/material-symbols/account-tree-outline";
import MsAdminPanelSettingsOutline from "~icons/material-symbols/admin-panel-settings-outline";
import MsAllInclusive from "~icons/material-symbols/all-inclusive";
import MsAltRoute from "~icons/material-symbols/alt-route";
import MsBackpackOutline from "~icons/material-symbols/backpack-outline";
import MsCallMerge from "~icons/material-symbols/call-merge";
import MsCircleOutline from "~icons/material-symbols/circle-outline";
import MsClockLoader20 from "~icons/material-symbols/clock-loader-20";
import MsCloudDoneOutline from "~icons/material-symbols/cloud-done-outline";
import MsCodeOff from "~icons/material-symbols/code-off";
import MsDataInfoAlert from "~icons/material-symbols/data-info-alert";
import MsDataUsage from "~icons/material-symbols/data-usage";
import MsDragIndicator from "~icons/material-symbols/drag-indicator";
import MsEmergencyOutline from "~icons/material-symbols/emergency-outline";
import MsErrorOutline from "~icons/material-symbols/error-outline";
import MsExpandAll from "~icons/material-symbols/expand-all";
import MsFiberManualRecordOutline from "~icons/material-symbols/fiber-manual-record-outline";
import MsForkRight from "~icons/material-symbols/fork-right";
import MsFormatAlignLeft from "~icons/material-symbols/format-align-left";
import MsForward10 from "~icons/material-symbols/forward-10";
import MsFunctions from "~icons/material-symbols/functions";
import MsGraph2 from "~icons/material-symbols/graph-2";
import MsHistory from "~icons/material-symbols/history";
import MsHistoryToggleOff from "~icons/material-symbols/history-toggle-off";
import MsHourglassEmpty from "~icons/material-symbols/hourglass-empty";
import MsHubOutline from "~icons/material-symbols/hub-outline";
import MsInput from "~icons/material-symbols/input";
import MsJavascript from "~icons/material-symbols/javascript";
import MsLeftPanelClose from "~icons/material-symbols/left-panel-close";
import MsLeftPanelOpen from "~icons/material-symbols/left-panel-open";
import MsMerge from "~icons/material-symbols/merge";
import MsMoreHoriz from "~icons/material-symbols/more-horiz";
import MsMoreVert from "~icons/material-symbols/more-vert";
import MsNavigationOutline from "~icons/material-symbols/navigation-outline";
import MsPattern from "~icons/material-symbols/pattern";
import MsPets from "~icons/material-symbols/pets";
import MsProgressActivity from "~icons/material-symbols/progress-activity";
import MsPsychologyOutline from "~icons/material-symbols/psychology-outline";
import MsRadar from "~icons/material-symbols/radar";
import MsRadioButtonChecked from "~icons/material-symbols/radio-button-checked";
import MsRadioButtonUnchecked from "~icons/material-symbols/radio-button-unchecked";
import MsReceiptLongOutline from "~icons/material-symbols/receipt-long-outline";
import MsReplay from "~icons/material-symbols/replay";
import MsReplay10 from "~icons/material-symbols/replay-10";
import MsSchemaOutline from "~icons/material-symbols/schema-outline";
import MsSearchOff from "~icons/material-symbols/search-off";
import MsSoundSampler from "~icons/material-symbols/sound-sampler";
import MsSpeedOutline from "~icons/material-symbols/speed-outline";
import MsSyncDisabled from "~icons/material-symbols/sync-disabled";
import MsSyncProblemOutline from "~icons/material-symbols/sync-problem-outline";
import MsTabOutline from "~icons/material-symbols/tab-outline";
import MsTextFields from "~icons/material-symbols/text-fields";
import MsTimeline from "~icons/material-symbols/timeline";
import MsTitle from "~icons/material-symbols/title";
import MsToggleOffOutline from "~icons/material-symbols/toggle-off-outline";
import MsTouchApp from "~icons/material-symbols/touch-app";
import MsTransform from "~icons/material-symbols/transform";
import MsTroubleshoot from "~icons/material-symbols/troubleshoot";
import MsVisibilityOffOutline from "~icons/material-symbols/visibility-off-outline";
import MsVisibilityOutline from "~icons/material-symbols/visibility-outline";
import MsVitalSigns from "~icons/material-symbols/vital-signs";
import MsWebhook from "~icons/material-symbols/webhook";
import MsWrapText from "~icons/material-symbols/wrap-text";

export const iconRegistry = {
  "alarm": MgAlarmClock,
  "add": MgPlus,
  "arrow-back": MgArrowLeft,
  "arrow-back-ios-new": MgChevronLeft,
  "arrow-downward": MgArrowDown,
  "arrow-drop-down": MgCaretDown,
  "arrow-drop-up": MgCaretUp,
  "arrow-forward": MgArrowRight,
  "arrow-upward": MgArrowUp,
  "article": HeDocumentText,
  "attachment": MgAttachment,
  "stars": MgStarsA,
  "favorite": MgHeart,
  "favorite-border": MgHeart,
  "backpack": MsBackpackOutline,
  "block": HeNoSymbol,
  "bolt": MgBolt,
  "cached": MgRefresh,
  "calendar-month": MgCalendar,
  "campaign": MgMegaphoneA,
  "cancel": MgCancel,
  "redeem": MgGift,
  "receipt-long": MsReceiptLongOutline,
  "category": MgLayoutGrid,
  "check": MgCheck,
  "check-circle": MgCheckCircle,
  "chevron-left": MgChevronLeft,
  "backup": HeCloudArrowUp,
  "chevron-right": MgChevronRight,
  "close": MgX,
  "cloud": HeCloud,
  "code": HeCodeBracket,
  "compare-arrows": MgExchangeA,
  "content-copy": MgCopy,
  "delete": MgTrash,
  "download": MgDownload,
  "edit": HePencil,
  "error": MgExclamationCircle,
  "error-outline": MgExclamationCircle,
  "event": MgCalendar,
  "expand-more": MgChevronDown,
  "upload-file": MgFileUpload,
  "format-list-bulleted": HeListBullet,
  "fullscreen": MgMaximize,
  "group-work": MgUsers,
  "group-add": MgUserPlus,
  "groups": MgUsers,
  "how-to-reg": MgUserCheck,
  "help-outline": MgQuestionMarkCircle,
  "history": MsHistory,
  "info": MgInformationCircle,
  "info-filled": MgInformationCircle,
  "info-outline": MgInformationCircle,
  "account-balance": HeBuildingLibrary,
  "account-tree": MsAccountTreeOutline,
  "dark-mode": MgMoon,
  "draft": HeDocument,
  "drive-file-move": MgFolderOpen,
  "expand-less": MgChevronUp,
  "inventory-2": MgBox,
  "light-mode": MgSun,
  "schema": MsSchemaOutline,
  "wifi": MgWifi,
  "window": HeWindow,
  "javascript": MsJavascript,
  "keyboard-arrow-down": MgChevronDown,
  "keyboard-double-arrow-left": MgDoubleArrowLeft,
  "keyboard-double-arrow-right": MgDoubleArrowRight,
  "language": MgGlobe,
  "link": MgLink,
  "location-on": MgLocationPin,
  "more-vert": MsMoreVert,
  "menu": HeBars3,
  "open-in-new": MgExternalLink,
  "organization": HeBuildingOffice,
  "pause": MgPause,
  "pause-circle-filled": HePauseCircle,
  "person": MgUser,
  "person-add": MgUserPlus,
  "play-arrow": MgPlay,
  "preview": MgPreview,
  "query-stats": MgChart,
  "refresh": MgRefresh,
  "replay": MsReplay,
  "replay-10": MsReplay10,
  "forward-10": MsForward10,
  "schedule": MgClock,
  "search": MgSearch,
  "send": HePaperAirplane,
  "share": MgShare,
  "settings": MgSettings,
  "shield": MgSecurityShield,
  "show-chart": MgChartUp,
  "timeline": MsTimeline,
  "tune": HeAdjustmentsHorizontal,
  "visibility": MsVisibilityOutline,
  "visibility-off": MsVisibilityOffOutline,
  "warning": MgExclamationTriangle,
  "workspaces": MgLayoutGrid,
  "workspace-premium": MgRibbon,
  "unfold-less": MgMinimize,
  "left-panel-close": MsLeftPanelClose,
  "left-panel-open": MsLeftPanelOpen,
  "reorder": HeBars3,
  "first-page": MgDoubleArrowLeft,
  "last-page": MgDoubleArrowRight,
  "dashboard": MgDashboard,
  "access-time": MgClock,
  "activity": MsVitalSigns,
  "align-left": MsFormatAlignLeft,
  "all-inclusive": MsAllInclusive,
  "assignment-turned-in": MgChecklistNote,
  "auto-awesome": HeSparkles,
  "bar-chart": MgChartVertical,
  "bookmark": MgBookmark,
  "build": MgWrench,
  "business": HeBuildingOffice,
  "chat": MgMessage,
  "check-box": MgCheckSquare,
  "close-fullscreen": MgMinimize,
  "data-object": HeCodeBracket,
  "database": MgDatabase,
  "description": HeDocumentText,
  "dns": MgServer,
  "fork-right": MsForkRight,
  "git-branch": MsForkRight,
  "graph-2": MsGraph2,
  "flame": MgFireA,
  "whatshot": MgFireA,
  "brain-circuit": MsPsychologyOutline,
  "key": MgKey,
  "admin-panel-settings": MsAdminPanelSettingsOutline,
  "fact-check": MgChecklist,
  "alt-route": MsAltRoute,
  "emergency": MsEmergencyOutline,
  "compress": MgMinimize,
  "pattern": MsPattern,
  "call-merge": MsCallMerge,
  "auto-graph": MgChartUp,
  "play-circle-filled": MgPlayCircle,
  "pets": MsPets,
  "monitor-heart": MgHeartHealth,
  "dataset": HeTableCells,
  "folder-open": MgFolderOpen,
  "folder": MgFolder,
  "folder-outline": MgFolder,
  "widgets": HeSquares2x2,
  "lan": HeShare,
  "trending-up-filled": HeArrowTrendingUp,
  "view-in-ar": HeCube,
  "input": MsInput,
  "transform": MsTransform,
  "processing": MsTransform,
  "navigate-before": MgChevronLeft,
  "navigate-next": MgChevronRight,
  "fullscreen-exit": MgMinimize,
  "group": MgUsers,
  "hourglass-empty": MsHourglassEmpty,
  "label": MgTag,
  "layers": MgStack,
  "mail": MgEmail,
  "manage-search": MgSearch,
  "merge": MsMerge,
  "more-horiz": MsMoreHoriz,
  "navigation": MsNavigationOutline,
  "notifications": MgNotificationBell,
  "open-in-full": MgMaximize,
  "play-circle": MgPlayCircle,
  "smart-toy": MgRobot,
  "speed": MsSpeedOutline,
  "stop-circle": MgStopCircle,
  "storage": HeCircleStack,
  "table-chart": HeTableCells,
  "timer": MgClock,
  "title": MsTitle,
  "trending-up": HeArrowTrendingUp,
  "undo": HeArrowUturnLeft,
  "unfold-more": HeArrowsUpDown,
  "upload": MgUpload,
  "verified-user": MgShieldCheck,
  "webhook": MsWebhook,
  "menu-book": MgBook,
  "add-circle": MgPlusCircle,
  "add-circle-outline": MgPlusCircle,
  "ads-click": MgMousePointer,
  "analytics": MgChartVertical,
  "arrow-back-ios": MgChevronLeft,
  "arrow-forward-ios": MgChevronRight,
  "arrow-right": MgArrowRight,
  "arrow-right-alt": MgArrowRight,
  "assessment": MgChartVertical,
  "assignment": MgClipboard,
  "attach-file": MgAttachment,
  "attach-money": MgDollar,
  "sound-sampler": MsSoundSampler,
  "clock-loader-20": MsClockLoader20,
  "data-info-alert": MsDataInfoAlert,
  "function": HeVariable,
  "list": HeListBullet,
  "123": Ms123,
  "paid": MgDollar,
  "autorenew": MgRefresh,
  "progress-activity": MsProgressActivity,
  "card-giftcard": MgGift,
  "check-circle-outline": MgCheckCircle,
  "circle": MsCircleOutline,
  "clear": MgX,
  "cloud-done": MsCloudDoneOutline,
  "cloud-upload": HeCloudArrowUp,
  "code-off": MsCodeOff,
  "color-lens": MgColorSwatch,
  "colorize": MgColorPicker,
  "compare": MgExchangeA,
  "corporate-fare": HeBuildingOffice2,
  "dashboard-customize": MgDashboardPlus,
  "data-usage": MsDataUsage,
  "delete-outline": MgTrash,
  "delete-sweep": MgTrash2,
  "devices": MgLaptop,
  "drag-indicator": MsDragIndicator,
  "event-note": MgCalendar,
  "exit-to-app": MgLogout,
  "expand-all": MsExpandAll,
  "fast-forward": MgFastForward,
  "fast-rewind": MgFastForwardBack,
  "fiber-manual-record": MsFiberManualRecordOutline,
  "file-download": MgFileDownload,
  "file-upload": MgFileUpload,
  "filter-alt": MgFilter,
  "data-plus-line": HeServerStack,
  "filter-list": MgFilter,
  "flag": MgFlag,
  "format-list-numbered": HeNumberedList,
  "forum": MgMessageConversation,
  "functions": MsFunctions,
  "grid-on": HeTableCells,
  "help": MgQuestionMarkCircle,
  "history-toggle-off": MsHistoryToggleOff,
  "home": HeHome,
  "hub": MsHubOutline,
  "image": MgImage,
  "insights": MgChartUp,
  "keyboard-arrow-right": MgChevronRight,
  "keyboard-arrow-up": MgChevronUp,
  "lightbulb": MgLightBulb,
  "lightbulb-outline": MgLightBulb,
  "lock": MgLock,
  "login": MgLogin,
  "logout": MgLogout,
  "manage-accounts": MgUserCheck,
  "memory": MgChip,
  "monetization-on": MgDollar,
  "note-add": MgFilePlus,
  "notifications-active": MgNotificationBell,
  "palette": MgColorSwatch,
  "payments": MgCreditCard,
  "print": MgPrinter,
  "psychology": MsPsychologyOutline,
  "radar": MsRadar,
  "remove": MgMinus,
  "report-problem": MgExclamationTriangle,
  "shield-alert-outline": HeShieldExclamation,
  "restart-alt": MgRefresh,
  "rocket-launch": MgRocket,
  "rule": MgChecklist,
  "running-with-errors": MsErrorOutline,
  "save": MgSaveFloppy,
  "saved-search": MgSearch,
  "search-off": MsSearchOff,
  "security": MgSecurityShield,
  "sentiment-very-dissatisfied": HeFaceFrown,
  "stop": MgStop,
  "swap-horiz": MgExchangeA,
  "swap-vert": MgExchangeB,
  "sync": MgRefresh,
  "sync-disabled": MsSyncDisabled,
  "sync-problem": MsSyncProblemOutline,
  "table-view": HeTableCells,
  "tag": MgTag,
  "task-alt": MgCheckCircle,
  "text-fields": MsTextFields,
  "thumb-down-off-alt": HeHandThumbDown,
  "thumb-up-off-alt": HeHandThumbUp,
  "person-pin-circle": MgLocationPin,
  "toggle-off": MsToggleOffOutline,
  "trending-down": HeArrowTrendingDown,
  "troubleshoot": MsTroubleshoot,
  "update": MgRefresh,
  "verified": MgVerifiedCheck,
  "view-column": HeViewColumns,
  "volume-off": MgVolumeMute,
  "volume-up": MgVolumeUp,
  "warning-amber": MgExclamationTriangle,
  "wrap-text": MsWrapText,
  "radio-button-unchecked": MsRadioButtonUnchecked,
  "radio-button-checked": MsRadioButtonChecked,
  "touch-app": MsTouchApp,
  "network-check": HeSignal,
  "cloud-download": HeCloudArrowDown,
  "call-made": MgArrowUpRight,
  "call-received": MgArrowDownLeft,
  "inbox": MgInbox,
  "star-rate": MgStar,
  "card-membership": MgIdCard,
  "domain": HeBuildingOffice,
  "data-array": HeCodeBracket,
  "mouse": MgMouse,
  "plagiarism": HeDocumentMagnifyingGlass,
  "redo": HeArrowUturnRight,
  "tab": MsTabOutline,
  "web": HeGlobeAlt,
  "action-import": MgUpload,
  "action-move-to-folder": MgFolderOpen,
  "action-duplicate": MgCopy,
  "action-delete": MgTrash,
  "traces": HeQueueList,
} as const satisfies Record<string, Component>;

export type IconName = keyof typeof iconRegistry;
