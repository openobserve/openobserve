// ─────────────────────────────────────────────────────────────────────────────
// APPROVED ICON REGISTRY
//
// All icons used in the application must be listed here.
// Icons are resolved at build time by unplugin-icons — zero runtime fetches.
// This keeps the application fully functional in air-gapped environments.
//
// To add a new icon:
//   1. Find the icon at https://fonts.google.com/icons (Material Symbols)
//   2. Convert its name: snake_case → kebab-case  (e.g. arrow_forward → arrow-forward)
//   3. Add one import line below pointing to ~icons/material-symbols-light/{kebab-name}-outline
//      (use the -outline name when it exists; fall back to ~icons/material-symbols/ if absent)
//   4. Add the key → component pair to iconRegistry using the same kebab-case key
//
// NEVER accept arbitrary icon strings from consumers — IconName is a
// closed literal union derived from this registry. Unknown names are
// TypeScript compile errors, not runtime errors.
// ─────────────────────────────────────────────────────────────────────────────

import SidebarHome from "~icons/material-symbols-light/home-outline";
import SidebarAlert from "~icons/material-symbols-light/gpp-maybe-outline";
import SidebarAi from "~icons/material-symbols-light/wand-stars-outline";
import SidebarInsights from "~icons/material-symbols-light/query-stats-outline";
import SidebarIngestion from "~icons/material-symbols-light/database-upload-outline";
import SidebarIntel from "~icons/material-symbols-light/neurology-outline";
import SidebarChevronRight from "~icons/material-symbols-light/chevron-right-outline";
// Sidebar rail: regular weight (400) so 16px menu icons render about 1.3px lines, not a faint 0.75px haze.
import SbHome from "~icons/mdi/home-outline";
import SbSearch from "~icons/material-symbols/search-outline";
import SbBarChart from "~icons/material-symbols/bar-chart-4-bars-outline";
import SbAccountTree from "~icons/material-symbols/account-tree-outline";
import SbMemory from "~icons/material-symbols/memory-outline";
import SbDashboard from "~icons/material-symbols/dashboard-outline";
import SbDescription from "~icons/material-symbols/description-outline";
import SbShield from "~icons/material-symbols/shield-outline";
import SbTarget from "~icons/material-symbols/target-outline";
import SbNotificationsActive from "~icons/material-symbols/notifications-active-outline";
import SbDns from "~icons/material-symbols/dns-outline";
import SbDevices from "~icons/material-symbols/devices-outline";
import SbRadar from "~icons/material-symbols/radar-outline";
import SbNavigation from "~icons/material-symbols/navigation-outline";
import SbDatabase from "~icons/material-symbols/database-outline";
import SbWindow from "~icons/material-symbols/window-outline";
import SbLan from "~icons/material-symbols/lan-outline";
import SbSchema from "~icons/material-symbols/schema-outline";
import SbSettings from "~icons/material-symbols/settings-outline";
import SbManageAccounts from "~icons/material-symbols/manage-accounts-outline";
import SbPayments from "~icons/material-symbols/payments-outline";
import SbSidebarHome from "~icons/material-symbols/home-outline";
import SbSidebarAlert from "~icons/material-symbols/gpp-maybe-outline";
import SbSidebarAi from "~icons/material-symbols/wand-stars-outline";
import SbSidebarInsights from "~icons/material-symbols/query-stats-outline";
import SbSidebarIngestion from "~icons/material-symbols/database-upload-outline";
import SbSidebarIntel from "~icons/material-symbols/neurology-outline";
import SbSidebarChevronRight from "~icons/material-symbols/chevron-right-outline";
import Alarm from "~icons/material-symbols-light/alarm-outline";
// Glyph-only marks (kebab, plus, chevrons) use weight 400: the light 300 stroke antialiases below 3:1.
import Add from "~icons/material-symbols/add-outline";
import ArrowBack from "~icons/material-symbols-light/arrow-back-outline";
import ArrowBackIosNew from "~icons/material-symbols-light/arrow-back-ios-new-outline";
import ArrowDownward from "~icons/material-symbols-light/arrow-downward-outline";
import ArrowDropDown from "~icons/material-symbols-light/arrow-drop-down-outline";
import ArrowDropUp from "~icons/material-symbols-light/arrow-drop-up-outline";
import ArrowForward from "~icons/material-symbols-light/arrow-forward-outline";
import ArrowUpward from "~icons/material-symbols-light/arrow-upward-outline";
import Article from "~icons/material-symbols-light/article-outline";
import Attachment from "~icons/material-symbols-light/attachment-outline";
import Stars from "~icons/material-symbols-light/stars-outline";
import Backpack from "~icons/material-symbols-light/backpack-outline";
import Block from "~icons/material-symbols-light/block-outline";
import Bolt from "~icons/material-symbols-light/bolt-outline";
import Cached from "~icons/material-symbols-light/cached-outline";
import CalendarMonth from "~icons/material-symbols-light/calendar-month-outline";
import Campaign from "~icons/material-symbols-light/campaign-outline";
import Cancel from "~icons/material-symbols-light/cancel-outline";
import Redeem from "~icons/material-symbols-light/redeem-outline";
import ReceiptLong from "~icons/material-symbols-light/receipt-long-outline";
import Category from "~icons/material-symbols-light/category-outline";
import Check from "~icons/material-symbols-light/check-outline";
import CheckCircle from "~icons/material-symbols-light/check-circle-outline";
import ChevronLeft from "~icons/material-symbols/chevron-left-outline";
import ChevronRight from "~icons/material-symbols/chevron-right-outline";
import Close from "~icons/material-symbols-light/close-outline";
import Backup from "~icons/material-symbols-light/backup-outline";
import Cloud from "~icons/material-symbols-light/cloud-outline";
import CloudOff from "~icons/material-symbols-light/cloud-off-outline";
import Code from "~icons/material-symbols/code-outline";
import CompareArrows from "~icons/material-symbols-light/compare-arrows-outline";
import ContentCopy from "~icons/material-symbols-light/content-copy-outline";
import ContentPaste from "~icons/material-symbols-light/content-paste-outline";
import Delete from "~icons/material-symbols-light/delete-outline";
import Download from "~icons/material-symbols-light/download-outline";
import Edit from "~icons/material-symbols-light/edit-outline";
import EditNote from "~icons/material-symbols-light/edit-note-outline";
import Error from "~icons/material-symbols-light/error-outline";
import ErrorOutline from "~icons/material-symbols-light/error-outline";
import Event from "~icons/material-symbols-light/event-outline";
import EventAvailable from "~icons/material-symbols-light/event-available-outline";
import EventBusy from "~icons/material-symbols-light/event-busy-outline";
import ExpandMore from "~icons/material-symbols/expand-more";
import Extension from "~icons/material-symbols-light/extension-outline";
import UploadFile from "~icons/material-symbols-light/upload-file-outline";
import FormatListBulleted from "~icons/material-symbols-light/format-list-bulleted-outline";
import FormatBold from "~icons/material-symbols-light/format-bold-outline";
import FormatItalic from "~icons/material-symbols-light/format-italic-outline";
import Fullscreen from "~icons/material-symbols/fullscreen-outline";
import GroupWork from "~icons/material-symbols-light/group-work-outline";
import Groups from "~icons/material-symbols-light/groups-outline";
import GroupAdd from "~icons/material-symbols-light/group-add-outline";
import HowToReg from "~icons/material-symbols-light/how-to-reg-outline";
import HelpOutline from "~icons/material-symbols-light/help-outline";
import History from "~icons/material-symbols-light/history-outline";
import InfoFilled from "~icons/material-symbols-light/info";
import Info from "~icons/material-symbols-light/info-outline";
import InfoOutline from "~icons/material-symbols-light/info-outline";
import AccountBalance from "~icons/material-symbols-light/account-balance-outline";
import AccountTree from "~icons/material-symbols-light/account-tree-outline";
import DarkMode from "~icons/material-symbols-light/dark-mode-outline";
import Draft from "~icons/material-symbols-light/draft-outline";
import DriveFileMove from "~icons/material-symbols-light/drive-file-move-outline";
import ExpandLess from "~icons/material-symbols/expand-less";
import Inventory2 from "~icons/material-symbols-light/inventory-2-outline";
import LightMode from "~icons/material-symbols-light/light-mode-outline";
import Schema from "~icons/material-symbols-light/schema-outline";
import Wifi from "~icons/material-symbols-light/wifi-outline";
import Window from "~icons/material-symbols-light/window-outline";
import Javascript from "~icons/material-symbols-light/javascript-outline";
import Keep from "~icons/material-symbols-light/keep";
import KeepOutline from "~icons/material-symbols-light/keep-outline";
import KeyboardArrowDown from "~icons/material-symbols/keyboard-arrow-down-outline";
import KeyboardDoubleArrowLeft from "~icons/material-symbols-light/keyboard-double-arrow-left-outline";
import KeyboardDoubleArrowRight from "~icons/material-symbols-light/keyboard-double-arrow-right-outline";
import Language from "~icons/material-symbols-light/language-outline";
import Link from "~icons/material-symbols-light/link-outline";
import LinkOff from "~icons/material-symbols-light/link-off-outline";
import LocationOn from "~icons/material-symbols-light/location-on-outline";
import MoreVert from "~icons/material-symbols/more-vert-outline";
import MenuIcon from "~icons/material-symbols-light/menu-outline";
import OpenInNew from "~icons/material-symbols-light/open-in-new-outline";
import Pause from "~icons/material-symbols-light/pause-outline";
import PauseCircleFilled from "~icons/material-symbols-light/pause-circle-outline";
import Person from "~icons/material-symbols-light/person-outline";
import PersonAdd from "~icons/material-symbols-light/person-add-outline";
import PlayArrow from "~icons/material-symbols-light/play-arrow-outline";
import Preview from "~icons/material-symbols-light/preview-outline";
import QueryStats from "~icons/material-symbols-light/query-stats-outline";
import Refresh from "~icons/material-symbols/refresh-outline";
import Replay from "~icons/material-symbols-light/replay-outline";
import Replay10 from "~icons/material-symbols-light/replay-10-outline";
import Forward10 from "~icons/material-symbols-light/forward-10-outline";
import Schedule from "~icons/material-symbols-light/schedule-outline";
import Science from "~icons/material-symbols-light/science-outline";
import Search from "~icons/material-symbols-light/search-outline";
import Send from "~icons/material-symbols-light/send-outline";
import Share from "~icons/material-symbols-light/share-outline";
import Settings from "~icons/material-symbols-light/settings-outline";
import Shield from "~icons/material-symbols-light/shield-outline";
import ShowChart from "~icons/material-symbols-light/show-chart-outline";
import Timeline from "~icons/material-symbols-light/timeline-outline";
import Tune from "~icons/material-symbols-light/tune-outline";
import Visibility from "~icons/material-symbols-light/visibility-outline";
import VisibilityOff from "~icons/material-symbols-light/visibility-off-outline";
import Warning from "~icons/material-symbols-light/warning-outline";
import Workspaces from "~icons/material-symbols-light/workspaces-outline";
import WorkspacePremium from "~icons/material-symbols-light/workspace-premium-outline";
import UnfoldLess from "~icons/material-symbols-light/unfold-less-outline";
import LeftPanelClose from "~icons/material-symbols-light/left-panel-close-outline";
import LeftPanelOpen from "~icons/material-symbols-light/left-panel-open-outline";
import PinDrop from "~icons/material-symbols-light/pin-drop-outline";
import Reorder from "~icons/material-symbols-light/reorder-outline";
import FirstPage from "~icons/material-symbols-light/first-page-outline";
import LastPage from "~icons/material-symbols-light/last-page-outline";
import Dashboard from "~icons/material-symbols-light/dashboard-outline";
import AccessTime from "~icons/material-symbols-light/schedule-outline";
import Activity from "~icons/material-symbols-light/vital-signs-outline";
import AlignLeft from "~icons/material-symbols-light/format-align-left-outline";
import AlignRight from "~icons/material-symbols-light/format-align-right-outline";
import AllInclusive from "~icons/material-symbols-light/all-inclusive-outline";
import Apps from "~icons/material-symbols-light/apps-outline";
import AssignmentTurnedIn from "~icons/material-symbols-light/assignment-turned-in-outline";
// Not in the light set, so this one stays on the regular weight.
import AutoAwesome from "~icons/material-symbols/auto-awesome-outline";
import BarChart from "~icons/material-symbols-light/bar-chart-4-bars-outline";
import Bookmark from "~icons/material-symbols-light/bookmark-outline";
import BookmarkAdd from "~icons/material-symbols-light/bookmark-add-outline";
import Build from "~icons/material-symbols-light/build-outline";
import Business from "~icons/material-symbols-light/business-center-outline";
import Chat from "~icons/material-symbols-light/chat-outline";
import CheckBoxIcon from "~icons/material-symbols-light/check-box-outline";
import CloseFullscreen from "~icons/material-symbols-light/close-fullscreen-outline";
import DataObject from "~icons/material-symbols-light/data-object-outline";
import Database from "~icons/material-symbols-light/database-outline";
import Description from "~icons/material-symbols-light/description-outline";
import Dns from "~icons/material-symbols-light/dns-outline";
import ForkRight from "~icons/material-symbols-light/fork-right-outline";
import FullscreenExit from "~icons/material-symbols/fullscreen-exit-outline";
import FitScreen from "~icons/material-symbols-light/fit-screen-outline";
import Group from "~icons/material-symbols-light/group-outline";
import HourglassEmpty from "~icons/material-symbols-light/hourglass-empty-outline";
import Label from "~icons/material-symbols-light/label-outline";
import Layers from "~icons/material-symbols-light/layers-outline";
import Public from "~icons/material-symbols-light/public-outline";
import Mail from "~icons/material-symbols-light/mail-outline";
import MarkEmailUnread from "~icons/material-symbols-light/mark-email-unread-outline";
import ManageSearch from "~icons/material-symbols-light/manage-search-outline";
import Merge from "~icons/material-symbols-light/merge-outline";
import MoreHoriz from "~icons/material-symbols/more-horiz-outline";
import NavigationIcon from "~icons/material-symbols-light/navigation-outline";
import Notifications from "~icons/material-symbols-light/notifications-outline";
import OpenInFull from "~icons/material-symbols-light/open-in-full-outline";
import PlayCircle from "~icons/material-symbols-light/play-circle-outline";
import SmartToy from "~icons/material-symbols-light/smart-toy-outline";
import Terminal from "~icons/material-symbols-light/terminal-outline";
import Speed from "~icons/material-symbols-light/speed-outline";
import Target from "~icons/material-symbols-light/target-outline";
import TrackChanges from "~icons/material-symbols-light/track-changes-outline";
import LocalFireDepartment from "~icons/material-symbols-light/local-fire-department-outline";
import StopCircle from "~icons/material-symbols-light/stop-circle-outline";
import Storage from "~icons/material-symbols-light/storage-outline";
import TableChart from "~icons/material-symbols-light/table-chart-outline";
import TimerIcon from "~icons/material-symbols-light/timer-outline";
import Title from "~icons/material-symbols-light/title-outline";
import TrendingUp from "~icons/material-symbols-light/trending-up-outline";
import Undo from "~icons/material-symbols-light/undo-outline";
import UnfoldMore from "~icons/material-symbols-light/unfold-more-outline";
import ZoomIn from "~icons/material-symbols-light/zoom-in-outline";
import ZoomOut from "~icons/material-symbols-light/zoom-out-outline";
import Upload from "~icons/material-symbols-light/upload-outline";
import VerifiedUser from "~icons/material-symbols-light/verified-user-outline";
import Webhook from "~icons/material-symbols-light/webhook-outline";
import MenuBook from "~icons/material-symbols-light/menu-book-outline";

import OpenInBrowser from "~icons/material-symbols-light/open-in-browser-outline";
import StackedLineChart from "~icons/material-symbols-light/stacked-line-chart-outline";
import Keyboard from "~icons/material-symbols-light/keyboard-outline";
import Checklist from "~icons/material-symbols-light/checklist-outline";
import PhotoCamera from "~icons/material-symbols-light/photo-camera-outline";

import AddCircleIcon from "~icons/material-symbols-light/add-circle-outline";
import AdsClickIcon from "~icons/material-symbols-light/ads-click-outline";
import AnalyticsIcon from "~icons/material-symbols-light/analytics-outline";
import DoNotDisturbOnIcon from "~icons/material-symbols-light/do-not-disturb-on-outline";
import LibraryAddIcon from "~icons/material-symbols-light/library-add-outline";
import ArrowBackIosIcon from "~icons/material-symbols-light/arrow-back-ios-outline";
import ArrowForwardIosIcon from "~icons/material-symbols-light/arrow-forward-ios-outline";
import ArrowRightIcon from "~icons/material-symbols-light/arrow-right-outline";
import ArrowRightAltIcon from "~icons/material-symbols-light/arrow-right-alt-outline";
import AssessmentIcon from "~icons/material-symbols-light/analytics-outline";
import AssignmentIcon from "~icons/material-symbols-light/assignment-outline";
import AttachFileIcon from "~icons/material-symbols-light/attach-file-outline";
import AttachMoneyIcon from "~icons/material-symbols-light/attach-money-outline";
// These icons don't ship an `-outline` variant in @iconify/material-symbols;
// the base names render the outlined glyph by default.
import SoundSampler from "~icons/material-symbols-light/sound-sampler-outline";
import ClockLoader20 from "~icons/material-symbols-light/clock-loader-20-outline";
import DataInfoAlert from "~icons/material-symbols-light/data-info-alert-outline";
import FunctionIcon from "~icons/material-symbols-light/function-outline";
import ListIcon from "~icons/material-symbols-light/list-outline";
import NumbersIcon from "~icons/material-symbols-light/123-outline";
import PaidIcon from "~icons/material-symbols-light/paid-outline-rounded";
import AutorenewIcon from "~icons/material-symbols-light/autorenew-outline";
import ProgressActivityIcon from "~icons/material-symbols-light/progress-activity-outline";
import CardGiftcardIcon from "~icons/material-symbols-light/redeem-outline";
import CircleIcon from "~icons/material-symbols-light/circle-outline";
import CloudDoneIcon from "~icons/material-symbols-light/cloud-done-outline";
import CloudUploadIcon from "~icons/material-symbols-light/backup-outline";
import CodeOffIcon from "~icons/material-symbols-light/code-off-outline";
import ColorLensIcon from "~icons/material-symbols-light/palette-outline";
import ColorizeIcon from "~icons/material-symbols-light/colorize-outline";
import CompareIcon from "~icons/material-symbols-light/compare-outline";
import CorporateFareIcon from "~icons/material-symbols-light/corporate-fare-outline";
import DashboardCustomizeIcon from "~icons/material-symbols-light/dashboard-customize-outline";
import DataUsageIcon from "~icons/material-symbols-light/data-usage-outline";
import DeleteSweepIcon from "~icons/material-symbols-light/delete-sweep-outline";
import DevicesIcon from "~icons/material-symbols-light/devices-outline";
import DragIndicatorIcon from "~icons/material-symbols-light/drag-indicator-outline";
import EventNoteIcon from "~icons/material-symbols-light/event-note-outline";
import ExitToAppIcon from "~icons/material-symbols-light/exit-to-app-outline";
import ExpandAllIcon from "~icons/material-symbols-light/expand-all-outline";
import FastForwardIcon from "~icons/material-symbols-light/fast-forward-outline";
import FastRewindIcon from "~icons/material-symbols-light/fast-rewind-outline";
import FiberManualRecordIcon from "~icons/material-symbols-light/fiber-manual-record-outline";
import FileDownloadIcon from "~icons/material-symbols-light/download-outline";
import FilterAltIcon from "~icons/material-symbols-light/filter-alt-outline";
import DataPlusLineIcon from "~icons/majesticons/data-plus-line";
import FilterListIcon from "~icons/material-symbols-light/filter-list-outline";
import FlagIcon from "~icons/material-symbols-light/flag-outline";
import FormatListNumberedIcon from "~icons/material-symbols-light/format-list-numbered-outline";
import ForumIcon from "~icons/material-symbols-light/forum-outline";
import FunctionsIcon from "~icons/material-symbols-light/functions-outline";
import GridOnIcon from "~icons/material-symbols-light/grid-on-outline";
import HelpIcon from "~icons/material-symbols-light/help-outline";
import HistoryToggleOffIcon from "~icons/material-symbols-light/history-toggle-off-outline";
import HomeIcon from "~icons/mdi/home-outline";
import OrganizationIcon from "~icons/octicon/organization-16";
import Graph1Icon from "~icons/material-symbols-light/graph-1-outline";
import Graph2Icon from "~icons/material-symbols-light/graph-2-outline";
import HubIcon from "~icons/material-symbols-light/hub-outline";
import ImageIcon from "~icons/material-symbols-light/image-outline";
// Not in the light set, so this one stays on the regular weight.
import InsightsIcon from "~icons/material-symbols/insights";
import KeyboardArrowRightIcon from "~icons/material-symbols/chevron-right-outline";
import KeyboardArrowUpIcon from "~icons/material-symbols/keyboard-arrow-up-outline";
import LightbulbIcon from "~icons/material-symbols-light/lightbulb-outline";
import LockIcon from "~icons/material-symbols-light/lock-outline";
import LoginIcon from "~icons/material-symbols-light/login-outline";
import LogoutIcon from "~icons/material-symbols-light/logout-outline";
import ManageAccountsIcon from "~icons/material-symbols-light/manage-accounts-outline";
import MemoryIcon from "~icons/material-symbols-light/memory-outline";
import MonetizationOnIcon from "~icons/material-symbols-light/paid-outline-rounded";
import NoteAddIcon from "~icons/material-symbols-light/note-add-outline";
import NotificationsActiveIcon from "~icons/material-symbols-light/notifications-active-outline";
import PaletteIcon from "~icons/material-symbols-light/palette-outline";
import WaterDropIcon from "~icons/material-symbols-light/water-drop-outline";
import PaymentsIcon from "~icons/material-symbols-light/payments-outline";
import PrintIcon from "~icons/material-symbols-light/print-outline";
import PsychologyIcon from "~icons/material-symbols-light/psychology-outline";
import RadarIcon from "~icons/material-symbols-light/radar-outline";
import RemoveIcon from "~icons/material-symbols-light/remove-outline";
import ReportProblemIcon from "~icons/material-symbols-light/report-outline";
import ShieldAlertOutlineIcon from "~icons/mdi/shield-alert-outline";
import RestartAltIcon from "~icons/material-symbols-light/restart-alt-outline";
import RocketLaunchIcon from "~icons/material-symbols-light/rocket-launch-outline";
import RuleIcon from "~icons/material-symbols-light/rule-outline";
import RunningWithErrorsIcon from "~icons/material-symbols-light/error-outline";
import SaveIcon from "~icons/material-symbols-light/save-outline";
import SavedSearchIcon from "~icons/material-symbols-light/saved-search-outline";
import SearchOffIcon from "~icons/material-symbols-light/search-off-outline";
import SensorsOff from "~icons/material-symbols-light/sensors-off-outline";
import NotificationsPaused from "~icons/material-symbols-light/notifications-paused-outline";
import RepeatIcon from "~icons/material-symbols-light/repeat-outline";
import SecurityIcon from "~icons/material-symbols-light/shield-outline";
import SentimentVeryDissatisfiedIcon from "~icons/material-symbols-light/mood-bad-outline";
import AddReactionIcon from "~icons/material-symbols-light/add-reaction-outline";
import StopIcon from "~icons/material-symbols-light/stop-outline";
import SwapHorizIcon from "~icons/material-symbols-light/swap-horiz-outline";
import SwapVertIcon from "~icons/material-symbols-light/swap-vert-outline";
import SyncIcon from "~icons/material-symbols-light/sync-outline";
import SyncDisabledIcon from "~icons/material-symbols-light/sync-disabled-outline";
import SyncProblemIcon from "~icons/material-symbols-light/sync-problem-outline";
import TableViewIcon from "~icons/material-symbols-light/table-view-outline";
import TagIcon from "~icons/material-symbols-light/tag-outline";
import TaskAltIcon from "~icons/material-symbols-light/task-alt-outline";
import TextFieldsIcon from "~icons/material-symbols-light/text-fields-outline";
import ThumbDownOffAltIcon from "~icons/material-symbols-light/thumb-down-outline";
import ThumbUpOffAltIcon from "~icons/material-symbols-light/thumb-up-outline";
import PersonPinCircleIcon from "~icons/material-symbols-light/person-pin-circle-outline";
import ToggleOffIcon from "~icons/material-symbols-light/toggle-off-outline";
import TrendingDownIcon from "~icons/material-symbols-light/trending-down-outline";
import TrendingFlatIcon from "~icons/material-symbols-light/trending-flat-outline";
import TroubleshootIcon from "~icons/material-symbols-light/troubleshoot-outline";
import UpdateIcon from "~icons/material-symbols-light/update-outline";
import TvIcon from "~icons/material-symbols-light/tv-outline";
import VerifiedIcon from "~icons/material-symbols-light/verified-outline";
import ViewColumnIcon from "~icons/material-symbols-light/view-column-outline";
import VolumeOffIcon from "~icons/material-symbols-light/volume-off-outline";
import VolumeUpIcon from "~icons/material-symbols-light/volume-up-outline";
import WarningAmberIcon from "~icons/material-symbols-light/warning-outline";
import WrapTextIcon from "~icons/material-symbols-light/wrap-text-outline";
import Whatshot from "~icons/material-symbols-light/whatshot-outline";
import Key from "~icons/material-symbols-light/key-outline";
import AdminPanelSettings from "~icons/material-symbols-light/admin-panel-settings-outline";
import FactCheck from "~icons/material-symbols-light/fact-check-outline";
import AltRoute from "~icons/material-symbols-light/alt-route-outline";
import Emergency from "~icons/material-symbols-light/emergency-outline";
import Compress from "~icons/material-symbols-light/compress-outline";
import Pattern from "~icons/material-symbols-light/pattern-outline";
import CallMerge from "~icons/material-symbols-light/call-merge-outline";
// Not in the light set, so this one stays on the regular weight.
import AutoGraph from "~icons/material-symbols/auto-graph";
import PlayCircleFilled from "~icons/material-symbols-light/play-circle-outline";
import Pets from "~icons/material-symbols-light/pets-outline";
import MonitorHeart from "~icons/material-symbols-light/monitor-heart-outline";
import Dataset from "~icons/material-symbols-light/dataset-outline";
import FolderOpen from "~icons/material-symbols-light/folder-open-outline";
import Folder from "~icons/material-symbols-light/folder";
import FolderOutline from "~icons/material-symbols-light/folder-outline";
import Widgets from "~icons/material-symbols-light/widgets-outline";
import Lan from "~icons/material-symbols-light/lan-outline";
import CheckCircleOutline from "~icons/material-symbols-light/check-circle-outline";
import TrendingUpFilled from "~icons/material-symbols-light/trending-up-outline";
import ViewInAr from "~icons/material-symbols-light/view-in-ar-outline";
import Input from "~icons/material-symbols-light/input-outline";
import Transform from "~icons/material-symbols-light/transform-outline";
import Favorite from "~icons/material-symbols-light/favorite";
import FavoriteBorder from "~icons/material-symbols-light/favorite-outline";
import Star from "~icons/material-symbols-light/star";
import StarOutline from "~icons/material-symbols-light/star-outline";
import RadioButtonUnchecked from "~icons/material-symbols-light/radio-button-unchecked-outline";
import RadioButtonChecked from "~icons/material-symbols-light/radio-button-checked-outline";
import ComputerIcon from "~icons/material-symbols-light/computer-outline";
import TabletIcon from "~icons/material-symbols-light/tablet-outline";
import SmartphoneIcon from "~icons/material-symbols-light/smartphone-outline";
import TouchApp from "~icons/material-symbols-light/touch-app-outline";
import NetworkCheck from "~icons/material-symbols-light/network-check-outline";
import CloudDownload from "~icons/material-symbols-light/cloud-download-outline";
import CallMade from "~icons/material-symbols-light/call-made-outline";
import CallReceived from "~icons/material-symbols-light/call-received-outline";
import Inbox from "~icons/material-symbols-light/inbox-outline";
import StarRate from "~icons/material-symbols-light/star-rate-outline";
import CardMembership from "~icons/material-symbols-light/card-membership-outline";
import Domain from "~icons/material-symbols-light/domain-outline";
import DataArray from "~icons/material-symbols-light/data-array-outline";
import Mouse from "~icons/material-symbols-light/mouse-outline";
import Plagiarism from "~icons/material-symbols-light/plagiarism-outline";
import Redo from "~icons/material-symbols-light/redo-outline";
import Tab from "~icons/material-symbols-light/tab-outline";
import Web from "~icons/material-symbols-light/web-outline";
import SmartDisplay from "~icons/material-symbols-light/smart-display-outline";
import AndroidIcon from "~icons/material-symbols-light/android-outline";
import PhoneIphoneIcon from "~icons/material-symbols-light/phone-iphone-outline";
import CallIcon from "~icons/material-symbols-light/call-outline";

// Batch 6: Folder icon picker (2026-11-06)
import BugReportIcon from "~icons/material-symbols-light/bug-report-outline";
import ApiIcon from "~icons/material-symbols-light/api-outline";
import ShoppingCartIcon from "~icons/material-symbols-light/shopping-cart-outline";
import DeployedCodeIcon from "~icons/material-symbols-light/deployed-code-outline";
import RouterIcon from "~icons/material-symbols-light/router-outline";
import SupportAgentIcon from "~icons/material-symbols-light/support-agent-outline";
import CloudSyncIcon from "~icons/material-symbols-light/cloud-sync-outline";

// Brand marks (not Material Symbols) — local inline SVG components using currentColor.
import McpLogo from "./McpLogo.vue";
import SlackLogo from "./SlackLogo.vue";

import type { Component } from "vue";

export const iconRegistry = {
  "sidebar-home": SidebarHome,
  "sidebar-alert": SidebarAlert,
  "sidebar-ai": SidebarAi,
  "sidebar-insights": SidebarInsights,
  "sidebar-ingestion": SidebarIngestion,
  "sidebar-intel": SidebarIntel,
  "sidebar-chevron-right": SidebarChevronRight,
  "sb-home": SbHome,
  "sb-search": SbSearch,
  "sb-bar-chart": SbBarChart,
  "sb-account-tree": SbAccountTree,
  "sb-memory": SbMemory,
  "sb-dashboard": SbDashboard,
  "sb-description": SbDescription,
  "sb-shield": SbShield,
  "sb-target": SbTarget,
  "sb-notifications-active": SbNotificationsActive,
  "sb-dns": SbDns,
  "sb-devices": SbDevices,
  "sb-radar": SbRadar,
  "sb-navigation": SbNavigation,
  "sb-database": SbDatabase,
  "sb-window": SbWindow,
  "sb-lan": SbLan,
  "sb-schema": SbSchema,
  "sb-settings": SbSettings,
  "sb-manage-accounts": SbManageAccounts,
  "sb-payments": SbPayments,
  "sb-sidebar-home": SbSidebarHome,
  "sb-sidebar-alert": SbSidebarAlert,
  "sb-sidebar-ai": SbSidebarAi,
  "sb-sidebar-insights": SbSidebarInsights,
  "sb-sidebar-ingestion": SbSidebarIngestion,
  "sb-sidebar-intel": SbSidebarIntel,
  "sb-sidebar-chevron-right": SbSidebarChevronRight,
  alarm: Alarm,
  add: Add,
  mcp: McpLogo,
  slack: SlackLogo,
  "arrow-back": ArrowBack,
  "arrow-back-ios-new": ArrowBackIosNew,
  "arrow-downward": ArrowDownward,
  "arrow-drop-down": ArrowDropDown,
  "arrow-drop-up": ArrowDropUp,
  "arrow-forward": ArrowForward,
  "arrow-upward": ArrowUpward,
  article: Article,
  attachment: Attachment,
  stars: Stars,
  favorite: Favorite,
  "favorite-border": FavoriteBorder,
  star: Star,
  "star-outline": StarOutline,
  backpack: Backpack,
  block: Block,
  bolt: Bolt,
  cached: Cached,
  "calendar-month": CalendarMonth,
  campaign: Campaign,
  cancel: Cancel,
  redeem: Redeem,
  "receipt-long": ReceiptLong,
  category: Category,
  check: Check,
  "check-circle": CheckCircle,
  "chevron-left": ChevronLeft,
  backup: Backup,
  "chevron-right": ChevronRight,
  close: Close,
  cloud: Cloud,
  "cloud-off": CloudOff,
  code: Code,
  "compare-arrows": CompareArrows,
  "content-copy": ContentCopy,
  "content-paste": ContentPaste,
  delete: Delete,
  download: Download,
  edit: Edit,
  "edit-note": EditNote,
  error: Error,
  "error-outline": ErrorOutline,
  event: Event,
  "event-available": EventAvailable,
  "event-busy": EventBusy,
  "expand-more": ExpandMore,
  extension: Extension,
  "upload-file": UploadFile,
  "format-list-bulleted": FormatListBulleted,
  "format-bold": FormatBold,
  "format-italic": FormatItalic,
  fullscreen: Fullscreen,
  "group-work": GroupWork,
  "group-add": GroupAdd,
  groups: Groups,
  "how-to-reg": HowToReg,
  "help-outline": HelpOutline,
  history: History,
  info: Info,
  "info-filled": InfoFilled,
  "info-outline": InfoOutline,
  "account-balance": AccountBalance,
  "account-tree": AccountTree,
  "dark-mode": DarkMode,
  draft: Draft,
  "drive-file-move": DriveFileMove,
  "expand-less": ExpandLess,
  "inventory-2": Inventory2,
  "light-mode": LightMode,
  schema: Schema,
  wifi: Wifi,
  window: Window,
  javascript: Javascript,
  keep: Keep,
  "keep-outline": KeepOutline,
  "keyboard-arrow-down": KeyboardArrowDown,
  "keyboard-double-arrow-left": KeyboardDoubleArrowLeft,
  "keyboard-double-arrow-right": KeyboardDoubleArrowRight,
  language: Language,
  link: Link,
  "link-off": LinkOff,
  "location-on": LocationOn,
  "more-vert": MoreVert,
  menu: MenuIcon,
  "open-in-new": OpenInNew,
  organization: OrganizationIcon,
  pause: Pause,
  "pause-circle-filled": PauseCircleFilled,
  person: Person,
  "person-add": PersonAdd,
  "play-arrow": PlayArrow,
  preview: Preview,
  "query-stats": QueryStats,
  refresh: Refresh,
  replay: Replay,
  "replay-10": Replay10,
  "forward-10": Forward10,
  schedule: Schedule,
  science: Science,
  search: Search,
  send: Send,
  share: Share,
  settings: Settings,
  shield: Shield,
  "show-chart": ShowChart,
  timeline: Timeline,
  tune: Tune,
  visibility: Visibility,
  "visibility-off": VisibilityOff,
  warning: Warning,
  workspaces: Workspaces,
  "workspace-premium": WorkspacePremium,
  "unfold-less": UnfoldLess,
  "left-panel-close": LeftPanelClose,
  "left-panel-open": LeftPanelOpen,
  "pin-drop": PinDrop,
  reorder: Reorder,
  "first-page": FirstPage,
  "last-page": LastPage,
  dashboard: Dashboard,
  "access-time": AccessTime,
  activity: Activity,
  "align-left": AlignLeft,
  "align-right": AlignRight,
  "all-inclusive": AllInclusive,
  apps: Apps,
  "assignment-turned-in": AssignmentTurnedIn,
  "auto-awesome": AutoAwesome,
  "bar-chart": BarChart,
  bookmark: Bookmark,
  "bookmark-add": BookmarkAdd,
  build: Build,
  business: Business,
  chat: Chat,
  "check-box": CheckBoxIcon,
  "close-fullscreen": CloseFullscreen,
  "data-object": DataObject,
  database: Database,
  description: Description,
  dns: Dns,
  "fork-right": ForkRight,
  "git-branch": ForkRight,
  "graph-1": Graph1Icon,
  "graph-2": Graph2Icon,
  flame: Whatshot,
  whatshot: Whatshot,
  "brain-circuit": PsychologyIcon,
  key: Key,
  "admin-panel-settings": AdminPanelSettings,
  "fact-check": FactCheck,
  "alt-route": AltRoute,
  emergency: Emergency,
  compress: Compress,
  pattern: Pattern,
  "call-merge": CallMerge,
  "auto-graph": AutoGraph,
  "play-circle-filled": PlayCircleFilled,
  pets: Pets,
  "monitor-heart": MonitorHeart,
  dataset: Dataset,
  "folder-open": FolderOpen,
  folder: Folder,
  "folder-outline": FolderOutline,
  widgets: Widgets,
  lan: Lan,
  "trending-up-filled": TrendingUpFilled,
  "view-in-ar": ViewInAr,
  input: Input,
  transform: Transform,
  processing: Transform,
  "navigate-before": ChevronLeft,
  "navigate-next": ChevronRight,
  "fullscreen-exit": FullscreenExit,
  "fit-screen": FitScreen,
  group: Group,
  "hourglass-empty": HourglassEmpty,
  label: Label,
  layers: Layers,
  public: Public,
  mail: Mail,
  "mark-email-unread": MarkEmailUnread,
  "manage-search": ManageSearch,
  merge: Merge,
  "more-horiz": MoreHoriz,
  navigation: NavigationIcon,
  notifications: Notifications,
  "open-in-full": OpenInFull,
  "play-circle": PlayCircle,
  "smart-toy": SmartToy,
  terminal: Terminal,
  speed: Speed,
  target: Target,
  "track-changes": TrackChanges,
  "local-fire-department": LocalFireDepartment,
  "stop-circle": StopCircle,
  storage: Storage,
  "table-chart": TableChart,
  timer: TimerIcon,
  title: Title,
  "trending-up": TrendingUp,
  undo: Undo,
  "unfold-more": UnfoldMore,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
  upload: Upload,
  "verified-user": VerifiedUser,
  webhook: Webhook,
  "menu-book": MenuBook,

  // Batch 2: Additional icons (2026-05-16)
  "add-circle": AddCircleIcon,
  "add-circle-outline": AddCircleIcon,
  "ads-click": AdsClickIcon,
  "do-not-disturb-on": DoNotDisturbOnIcon,
  "library-add": LibraryAddIcon,
  analytics: AnalyticsIcon,
  "arrow-back-ios": ArrowBackIosIcon,
  "arrow-forward-ios": ArrowForwardIosIcon,
  "arrow-right": ArrowRightIcon,
  "arrow-right-alt": ArrowRightAltIcon,
  assessment: AssessmentIcon,
  assignment: AssignmentIcon,
  "attach-file": AttachFileIcon,
  "attach-money": AttachMoneyIcon,
  "sound-sampler": SoundSampler,
  "clock-loader-20": ClockLoader20,
  "data-info-alert": DataInfoAlert,
  function: FunctionIcon,
  list: ListIcon,
  "123": NumbersIcon,
  paid: PaidIcon,
  autorenew: AutorenewIcon,
  "progress-activity": ProgressActivityIcon,
  "card-giftcard": CardGiftcardIcon,
  "check-circle-outline": CheckCircleOutline,
  circle: CircleIcon,
  clear: Close,
  "cloud-done": CloudDoneIcon,
  "cloud-upload": CloudUploadIcon,
  "code-off": CodeOffIcon,
  "color-lens": ColorLensIcon,
  colorize: ColorizeIcon,
  compare: CompareIcon,
  "corporate-fare": CorporateFareIcon,
  "dashboard-customize": DashboardCustomizeIcon,
  "data-usage": DataUsageIcon,
  "delete-outline": Delete,
  "delete-sweep": DeleteSweepIcon,
  devices: DevicesIcon,
  "drag-indicator": DragIndicatorIcon,
  "event-note": EventNoteIcon,
  "exit-to-app": ExitToAppIcon,
  "expand-all": ExpandAllIcon,
  "fast-forward": FastForwardIcon,
  "fast-rewind": FastRewindIcon,
  "fiber-manual-record": FiberManualRecordIcon,
  "file-download": FileDownloadIcon,
  "file-upload": UploadFile,
  "filter-alt": FilterAltIcon,
  "data-plus-line": DataPlusLineIcon,
  "filter-list": FilterListIcon,
  flag: FlagIcon,
  "format-list-numbered": FormatListNumberedIcon,
  forum: ForumIcon,
  functions: FunctionsIcon,
  "grid-on": GridOnIcon,
  help: HelpIcon,
  "history-toggle-off": HistoryToggleOffIcon,
  home: HomeIcon,
  hub: HubIcon,
  image: ImageIcon,
  insights: InsightsIcon,
  "keyboard-arrow-right": KeyboardArrowRightIcon,
  "keyboard-arrow-up": KeyboardArrowUpIcon,
  lightbulb: LightbulbIcon,
  "lightbulb-outline": LightbulbIcon,
  lock: LockIcon,
  login: LoginIcon,
  logout: LogoutIcon,
  "manage-accounts": ManageAccountsIcon,
  memory: MemoryIcon,
  "monetization-on": MonetizationOnIcon,
  "note-add": NoteAddIcon,
  "notifications-active": NotificationsActiveIcon,
  palette: PaletteIcon,
  payments: PaymentsIcon,
  "water-drop": WaterDropIcon,
  print: PrintIcon,
  psychology: PsychologyIcon,
  radar: RadarIcon,
  remove: RemoveIcon,
  "report-problem": ReportProblemIcon,
  "shield-alert-outline": ShieldAlertOutlineIcon,
  "restart-alt": RestartAltIcon,
  "rocket-launch": RocketLaunchIcon,
  rule: RuleIcon,
  "running-with-errors": RunningWithErrorsIcon,
  save: SaveIcon,
  "saved-search": SavedSearchIcon,
  "search-off": SearchOffIcon,
  security: SecurityIcon,
  "sentiment-very-dissatisfied": SentimentVeryDissatisfiedIcon,
  "add-reaction": AddReactionIcon,
  stop: StopIcon,
  "swap-horiz": SwapHorizIcon,
  "swap-vert": SwapVertIcon,
  sync: SyncIcon,
  "sync-disabled": SyncDisabledIcon,
  "sync-problem": SyncProblemIcon,
  "table-view": TableViewIcon,
  tag: TagIcon,
  "task-alt": TaskAltIcon,
  "text-fields": TextFieldsIcon,
  "thumb-down-off-alt": ThumbDownOffAltIcon,
  "thumb-up-off-alt": ThumbUpOffAltIcon,
  // "location-on": LocationOnIcon,
  "person-pin-circle": PersonPinCircleIcon,
  // "group-work": GroupWorkIcon,
  "toggle-off": ToggleOffIcon,
  "trending-down": TrendingDownIcon,
  "trending-flat": TrendingFlatIcon,
  troubleshoot: TroubleshootIcon,
  update: UpdateIcon,
  tv: TvIcon,
  verified: VerifiedIcon,
  "view-column": ViewColumnIcon,
  "volume-off": VolumeOffIcon,
  "volume-up": VolumeUpIcon,
  "warning-amber": WarningAmberIcon,
  "wrap-text": WrapTextIcon,
  "radio-button-unchecked": RadioButtonUnchecked,
  "radio-button-checked": RadioButtonChecked,
  computer: ComputerIcon,
  tablet: TabletIcon,
  smartphone: SmartphoneIcon,
  "touch-app": TouchApp,
  "network-check": NetworkCheck,
  "cloud-download": CloudDownload,
  "call-made": CallMade,
  "call-received": CallReceived,
  inbox: Inbox,
  "star-rate": StarRate,
  "card-membership": CardMembership,
  domain: Domain,
  "data-array": DataArray,
  mouse: Mouse,
  plagiarism: Plagiarism,
  redo: Redo,
  tab: Tab,
  web: Web,
  android: AndroidIcon,
  "phone-iphone": PhoneIphoneIcon,
  call: CallIcon,

  // Batch 3: Synthetics / browser-check icons (2026-06-22)
  // (duplicate "person-pin-circle" from batch 2 removed — keep the first entry at line 624)
  "open-in-browser": OpenInBrowser,
  "stacked-line-chart": StackedLineChart,
  keyboard: Keyboard,
  checklist: Checklist,
  "photo-camera": PhotoCamera,
  "smart-display": SmartDisplay,

  // Batch 4: Alert Library (2026-08-20)
  // "no signal arriving" — the alert library's not-ingesting-this-stream state.
  "sensors-off": SensorsOff,

  // Batch 5: Downtimes (2026-09-24)
  "notifications-paused": NotificationsPaused,
  repeat: RepeatIcon,

  // Batch 6: Folder icon picker (2026-11-06)
  "bug-report": BugReportIcon,
  api: ApiIcon,
  "shopping-cart": ShoppingCartIcon,
  "deployed-code": DeployedCodeIcon,
  router: RouterIcon,
  "support-agent": SupportAgentIcon,
  "cloud-sync": CloudSyncIcon,
} as const satisfies Record<string, Component>;

export type IconName = keyof typeof iconRegistry;
