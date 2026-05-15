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
//   3. Add one import line below pointing to ~icons/material-symbols/{kebab-name}
//   4. Add the key → component pair to iconRegistry using the same kebab-case key
//
// NEVER accept arbitrary icon strings from consumers — IconName is a
// closed literal union derived from this registry. Unknown names are
// TypeScript compile errors, not runtime errors.
// ─────────────────────────────────────────────────────────────────────────────

import Alarm from "~icons/material-symbols/alarm-outline";
import Add from "~icons/material-symbols/add";
import ArrowBack from "~icons/material-symbols/arrow-back";
import ArrowBackIosNew from "~icons/material-symbols/arrow-back-ios-new";
import ArrowDownward from "~icons/material-symbols/arrow-downward";
import ArrowDropDown from "~icons/material-symbols/arrow-drop-down";
import ArrowForward from "~icons/material-symbols/arrow-forward";
import ArrowUpward from "~icons/material-symbols/arrow-upward";
import Article from "~icons/material-symbols/article-outline";
import Attachment from "~icons/material-symbols/attachment";
import Stars from "~icons/material-symbols/stars-outline";
import Backpack from "~icons/material-symbols/backpack-outline";
import Block from "~icons/material-symbols/block-outline";
import Bolt from "~icons/material-symbols/bolt-outline";
import Cached from "~icons/material-symbols/cached";
import CalendarMonth from "~icons/material-symbols/calendar-month-outline";
import Campaign from "~icons/material-symbols/campaign-outline";
import Cancel from "~icons/material-symbols/cancel-outline";
import Redeem from "~icons/material-symbols/redeem";
import Category from "~icons/material-symbols/category-outline";
import Check from "~icons/material-symbols/check";
import CheckCircle from "~icons/material-symbols/check-circle-outline";
import ChevronLeft from "~icons/material-symbols/chevron-left";
import ChevronRight from "~icons/material-symbols/chevron-right";
import Close from "~icons/material-symbols/close";
import Backup from "~icons/material-symbols/backup-outline";
import Cloud from "~icons/material-symbols/cloud-outline";
import Code from "~icons/material-symbols/code";
import CompareArrows from "~icons/material-symbols/compare-arrows";
import ContentCopy from "~icons/material-symbols/content-copy-outline";
import Delete from "~icons/material-symbols/delete-outline";
import Download from "~icons/material-symbols/download";
import Edit from "~icons/material-symbols/edit-outline";
import Error from "~icons/material-symbols/error-outline";
import ErrorOutline from "~icons/material-symbols/error-outline";
import Event from "~icons/material-symbols/event-outline";
import ExpandMore from "~icons/material-symbols/expand-more";
import UploadFile from "~icons/material-symbols/upload-file-outline";
import FormatListBulleted from "~icons/material-symbols/format-list-bulleted";
import Fullscreen from "~icons/material-symbols/fullscreen";
import GroupWork from "~icons/material-symbols/group-work-outline";
import Groups from "~icons/material-symbols/groups-outline";
import HelpOutline from "~icons/material-symbols/help-outline";
import History from "~icons/material-symbols/history";
import Info from "~icons/material-symbols/info-outline";
import InfoOutline from "~icons/material-symbols/info-outline";
import AccountTree from "~icons/material-symbols/account-tree";
import DarkMode from "~icons/material-symbols/dark-mode";
import Draft from "~icons/material-symbols/draft-outline";
import DriveFileMove from "~icons/material-symbols/drive-file-move";
import ExpandLess from "~icons/material-symbols/expand-less";
import Inventory2 from "~icons/material-symbols/inventory-2-outline";
import LightMode from "~icons/material-symbols/light-mode";
import Schema from "~icons/material-symbols/schema";
import Window from "~icons/material-symbols/window";
import Javascript from "~icons/material-symbols/javascript";
import KeyboardArrowDown from "~icons/material-symbols/keyboard-arrow-down";
import KeyboardDoubleArrowLeft from "~icons/material-symbols/keyboard-double-arrow-left";
import KeyboardDoubleArrowRight from "~icons/material-symbols/keyboard-double-arrow-right";
import Language from "~icons/material-symbols/language";
import Link from "~icons/material-symbols/link";
import LocationOn from "~icons/material-symbols/location-on-outline";
import MoreVert from "~icons/material-symbols/more-vert";
import MenuIcon from "~icons/material-symbols/menu";
import OpenInNew from "~icons/material-symbols/open-in-new";
import Pause from "~icons/material-symbols/pause";
import Person from "~icons/material-symbols/person-outline";
import PlayArrow from "~icons/material-symbols/play-arrow-outline";
import Preview from "~icons/material-symbols/preview-outline";
import QueryStats from "~icons/material-symbols/query-stats";
import Refresh from "~icons/material-symbols/refresh";
import Replay from "~icons/material-symbols/replay";
import Schedule from "~icons/material-symbols/schedule-outline";
import Search from "~icons/material-symbols/search";
import Send from "~icons/material-symbols/send-outline";
import Share from "~icons/material-symbols/share-outline";
import Settings from "~icons/material-symbols/settings-outline";
import Shield from "~icons/material-symbols/shield-outline";
import ShowChart from "~icons/material-symbols/show-chart";
import Timeline from "~icons/material-symbols/timeline";
import Tune from "~icons/material-symbols/tune";
import Visibility from "~icons/material-symbols/visibility-outline";
import VisibilityOff from "~icons/material-symbols/visibility-off-outline";
import Warning from "~icons/material-symbols/warning-outline";
import Workspaces from "~icons/material-symbols/workspaces-outline";
import WorkspacePremium from "~icons/material-symbols/workspace-premium-outline";
import UnfoldLess from "~icons/material-symbols/unfold-less";
import Reorder from "~icons/material-symbols/reorder";
import FirstPage from "~icons/material-symbols/first-page";
import LastPage from "~icons/material-symbols/last-page";
import Dashboard from "~icons/material-symbols/dashboard-outline";
import AccessTime from "~icons/material-symbols/schedule-outline";
import Activity from "~icons/material-symbols/vital-signs";
import AlignLeft from "~icons/material-symbols/format-align-left";
import AllInclusive from "~icons/material-symbols/all-inclusive";
import AssignmentTurnedIn from "~icons/material-symbols/assignment-turned-in-outline";
import AutoAwesome from "~icons/material-symbols/wand-stars-outline";
import BarChart from "~icons/material-symbols/bar-chart-4-bars";
import Bookmark from "~icons/material-symbols/bookmark-outline";
import Build from "~icons/material-symbols/build-outline";
import Business from "~icons/material-symbols/business-center-outline";
import Chat from "~icons/material-symbols/chat-outline";
import CheckBoxIcon from "~icons/material-symbols/check-box-outline";
import CloseFullscreen from "~icons/material-symbols/close-fullscreen";
import DataObject from "~icons/material-symbols/data-object";
import Database from "~icons/material-symbols/database-outline";
import Description from "~icons/material-symbols/description-outline";
import Dns from "~icons/material-symbols/dns";
import ForkRight from "~icons/material-symbols/fork-right";
import FullscreenExit from "~icons/material-symbols/fullscreen-exit";
import Group from "~icons/material-symbols/group-outline";
import HourglassEmpty from "~icons/material-symbols/hourglass-empty";
import Label from "~icons/material-symbols/label-outline";
import Layers from "~icons/material-symbols/layers-outline";
import Mail from "~icons/material-symbols/mail-outline";
import ManageSearch from "~icons/material-symbols/manage-search";
import Merge from "~icons/material-symbols/merge";
import MoreHoriz from "~icons/material-symbols/more-horiz";
import NavigationIcon from "~icons/material-symbols/navigation-outline";
import Notifications from "~icons/material-symbols/notifications-outline";
import OpenInFull from "~icons/material-symbols/open-in-full";
import PlayCircle from "~icons/material-symbols/play-circle-outline";
import SmartToy from "~icons/material-symbols/smart-toy-outline";
import Speed from "~icons/material-symbols/speed";
import StopCircle from "~icons/material-symbols/stop-circle";
import Storage from "~icons/material-symbols/storage";
import TableChart from "~icons/material-symbols/table-chart-outline";
import TimerIcon from "~icons/material-symbols/timer-outline";
import Title from "~icons/material-symbols/title";
import TrendingUp from "~icons/material-symbols/trending-up";
import Undo from "~icons/material-symbols/undo";
import UnfoldMore from "~icons/material-symbols/unfold-more";
import Upload from "~icons/material-symbols/upload";
import VerifiedUser from "~icons/material-symbols/verified-user-outline";
import Webhook from "~icons/material-symbols/webhook";
import MenuBook from "~icons/material-symbols/menu-book-outline";

import type { Component } from "vue";

export const iconRegistry = {
  "alarm": Alarm,
  "add": Add,
  "arrow-back": ArrowBack,
  "arrow-back-ios-new": ArrowBackIosNew,
  "arrow-downward": ArrowDownward,
  "arrow-drop-down": ArrowDropDown,
  "arrow-forward": ArrowForward,
  "arrow-upward": ArrowUpward,
  "article": Article,
  "attachment": Attachment,
  "stars": Stars,
  "backpack": Backpack,
  "block": Block,
  "bolt": Bolt,
  "cached": Cached,
  "calendar-month": CalendarMonth,
  "campaign": Campaign,
  "cancel": Cancel,
  "redeem": Redeem,
  "category": Category,
  "check": Check,
  "check-circle": CheckCircle,
  "chevron-left": ChevronLeft,
  "backup": Backup,
  "chevron-right": ChevronRight,
  "close": Close,
  "cloud": Cloud,
  "code": Code,
  "compare-arrows": CompareArrows,
  "content-copy": ContentCopy,
  "delete": Delete,
  "download": Download,
  "edit": Edit,
  "error": Error,
  "error-outline": ErrorOutline,
  "event": Event,
  "expand-more": ExpandMore,
  "upload-file": UploadFile,
  "format-list-bulleted": FormatListBulleted,
  "fullscreen": Fullscreen,
  "group-work": GroupWork,
  "groups": Groups,
  "help-outline": HelpOutline,
  "history": History,
  "info": Info,
  "info-outline": InfoOutline,
  "account-tree": AccountTree,
  "dark-mode": DarkMode,
  "draft": Draft,
  "drive-file-move": DriveFileMove,
  "expand-less": ExpandLess,
  "inventory-2": Inventory2,
  "light-mode": LightMode,
  "schema": Schema,
  "window": Window,
  "javascript": Javascript,
  "keyboard-arrow-down": KeyboardArrowDown,
  "keyboard-double-arrow-left": KeyboardDoubleArrowLeft,
  "keyboard-double-arrow-right": KeyboardDoubleArrowRight,
  "language": Language,
  "link": Link,
  "location-on": LocationOn,
  "more-vert": MoreVert,
  "menu": MenuIcon,
  "open-in-new": OpenInNew,
  "pause": Pause,
  "person": Person,
  "play-arrow": PlayArrow,
  "preview": Preview,
  "query-stats": QueryStats,
  "refresh": Refresh,
  "replay": Replay,
  "schedule": Schedule,
  "search": Search,
  "send": Send,
  "share": Share,
  "settings": Settings,
  "shield": Shield,
  "show-chart": ShowChart,
  "timeline": Timeline,
  "tune": Tune,
  "visibility": Visibility,
  "visibility-off": VisibilityOff,
  "warning": Warning,
  "workspaces": Workspaces,
  "workspace-premium": WorkspacePremium,
  "unfold-less": UnfoldLess,
  "reorder": Reorder,
  "first-page": FirstPage,
  "last-page": LastPage,
  "dashboard": Dashboard,
  "access-time": AccessTime,
  "activity": Activity,
  "align-left": AlignLeft,
  "all-inclusive": AllInclusive,
  "assignment-turned-in": AssignmentTurnedIn,
  "auto-awesome": AutoAwesome,
  "bar-chart": BarChart,
  "bookmark": Bookmark,
  "build": Build,
  "business": Business,
  "chat": Chat,
  "check-box": CheckBoxIcon,
  "close-fullscreen": CloseFullscreen,
  "data-object": DataObject,
  "database": Database,
  "description": Description,
  "dns": Dns,
  "fork-right": ForkRight,
  "fullscreen-exit": FullscreenExit,
  "group": Group,
  "hourglass-empty": HourglassEmpty,
  "label": Label,
  "layers": Layers,
  "mail": Mail,
  "manage-search": ManageSearch,
  "merge": Merge,
  "more-horiz": MoreHoriz,
  "navigation": NavigationIcon,
  "notifications": Notifications,
  "open-in-full": OpenInFull,
  "play-circle": PlayCircle,
  "smart-toy": SmartToy,
  "speed": Speed,
  "stop-circle": StopCircle,
  "storage": Storage,
  "table-chart": TableChart,
  "timer": TimerIcon,
  "title": Title,
  "trending-up": TrendingUp,
  "undo": Undo,
  "unfold-more": UnfoldMore,
  "upload": Upload,
  "verified-user": VerifiedUser,
  "webhook": Webhook,
  "menu-book": MenuBook,
} as const satisfies Record<string, Component>;

export type IconName = keyof typeof iconRegistry;
