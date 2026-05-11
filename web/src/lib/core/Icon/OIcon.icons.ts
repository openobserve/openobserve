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
//   3. Add one import line below pointing to ~icons/material-symbols-light/{kebab-name}
//   4. Add the key → component pair to iconRegistry using the same kebab-case key
//
// NEVER accept arbitrary icon strings from consumers — IconName is a
// closed literal union derived from this registry. Unknown names are
// TypeScript compile errors, not runtime errors.
// ─────────────────────────────────────────────────────────────────────────────

import AccessTime from "~icons/material-symbols-light/access-time";
import Add from "~icons/material-symbols-light/add";
import ArrowBack from "~icons/material-symbols-light/arrow-back";
import ArrowBackIosNew from "~icons/material-symbols-light/arrow-back-ios-new";
import ArrowDownward from "~icons/material-symbols-light/arrow-downward";
import ArrowDropDown from "~icons/material-symbols-light/arrow-drop-down";
import ArrowForward from "~icons/material-symbols-light/arrow-forward";
import ArrowUpward from "~icons/material-symbols-light/arrow-upward";
import Article from "~icons/material-symbols-light/article";
import Attachment from "~icons/material-symbols-light/attachment";
import AutoAwesome from "~icons/material-symbols-light/auto-awesome";
import Backpack from "~icons/material-symbols-light/backpack";
import Block from "~icons/material-symbols-light/block";
import Bolt from "~icons/material-symbols-light/bolt";
import Cached from "~icons/material-symbols-light/cached";
import CalendarMonth from "~icons/material-symbols-light/calendar-month";
import Campaign from "~icons/material-symbols-light/campaign";
import Cancel from "~icons/material-symbols-light/cancel";
import CardGiftcard from "~icons/material-symbols-light/card-giftcard";
import Category from "~icons/material-symbols-light/category";
import Check from "~icons/material-symbols-light/check";
import CheckCircle from "~icons/material-symbols-light/check-circle";
import ChevronLeft from "~icons/material-symbols-light/chevron-left";
import ChevronRight from "~icons/material-symbols-light/chevron-right";
import Clear from "~icons/material-symbols-light/clear";
import Close from "~icons/material-symbols-light/close";
import Cloud from "~icons/material-symbols-light/cloud";
import CloudUpload from "~icons/material-symbols-light/cloud-upload";
import Code from "~icons/material-symbols-light/code";
import CompareArrows from "~icons/material-symbols-light/compare-arrows";
import ContentCopy from "~icons/material-symbols-light/content-copy";
import Delete from "~icons/material-symbols-light/delete";
import Download from "~icons/material-symbols-light/download";
import Edit from "~icons/material-symbols-light/edit";
import Error from "~icons/material-symbols-light/error";
import ErrorOutline from "~icons/material-symbols-light/error-outline";
import Event from "~icons/material-symbols-light/event";
import ExpandMore from "~icons/material-symbols-light/expand-more";
import FileUpload from "~icons/material-symbols-light/file-upload";
import FormatListBulleted from "~icons/material-symbols-light/format-list-bulleted";
import Fullscreen from "~icons/material-symbols-light/fullscreen";
import GroupWork from "~icons/material-symbols-light/group-work";
import Groups from "~icons/material-symbols-light/groups";
import HelpOutline from "~icons/material-symbols-light/help-outline";
import History from "~icons/material-symbols-light/history";
import Info from "~icons/material-symbols-light/info";
import InfoOutline from "~icons/material-symbols-light/info-outline";
import InsertDriveFile from "~icons/material-symbols-light/insert-drive-file";
import Inventory2 from "~icons/material-symbols-light/inventory-2";
import Javascript from "~icons/material-symbols-light/javascript";
import KeyboardArrowDown from "~icons/material-symbols-light/keyboard-arrow-down";
import KeyboardDoubleArrowLeft from "~icons/material-symbols-light/keyboard-double-arrow-left";
import KeyboardDoubleArrowRight from "~icons/material-symbols-light/keyboard-double-arrow-right";
import Language from "~icons/material-symbols-light/language";
import Link from "~icons/material-symbols-light/link";
import LocationOn from "~icons/material-symbols-light/location-on";
import MoreVert from "~icons/material-symbols-light/more-vert";
import NavigateBefore from "~icons/material-symbols-light/navigate-before";
import NavigateNext from "~icons/material-symbols-light/navigate-next";
import OpenInNew from "~icons/material-symbols-light/open-in-new";
import Person from "~icons/material-symbols-light/person";
import PlayArrow from "~icons/material-symbols-light/play-arrow";
import Preview from "~icons/material-symbols-light/preview";
import QueryStats from "~icons/material-symbols-light/query-stats";
import Refresh from "~icons/material-symbols-light/refresh";
import Replay from "~icons/material-symbols-light/replay";
import Schedule from "~icons/material-symbols-light/schedule";
import Search from "~icons/material-symbols-light/search";
import Send from "~icons/material-symbols-light/send";
import Share from "~icons/material-symbols-light/share";
import Settings from "~icons/material-symbols-light/settings";
import Shield from "~icons/material-symbols-light/shield";
import ShowChart from "~icons/material-symbols-light/show-chart";
import Timeline from "~icons/material-symbols-light/timeline";
import Tune from "~icons/material-symbols-light/tune";
import Visibility from "~icons/material-symbols-light/visibility";
import VisibilityOff from "~icons/material-symbols-light/visibility-off";
import Warning from "~icons/material-symbols-light/warning";
import Workspaces from "~icons/material-symbols-light/workspaces";
import WorkspacePremium from "~icons/material-symbols-light/workspace-premium";

import type { Component } from "vue";

export const iconRegistry = {
  "access-time": AccessTime,
  "add": Add,
  "arrow-back": ArrowBack,
  "arrow-back-ios-new": ArrowBackIosNew,
  "arrow-downward": ArrowDownward,
  "arrow-drop-down": ArrowDropDown,
  "arrow-forward": ArrowForward,
  "arrow-upward": ArrowUpward,
  "article": Article,
  "attachment": Attachment,
  "auto-awesome": AutoAwesome,
  "backpack": Backpack,
  "block": Block,
  "bolt": Bolt,
  "cached": Cached,
  "calendar-month": CalendarMonth,
  "campaign": Campaign,
  "cancel": Cancel,
  "card-giftcard": CardGiftcard,
  "category": Category,
  "check": Check,
  "check-circle": CheckCircle,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "clear": Clear,
  "close": Close,
  "cloud": Cloud,
  "cloud-upload": CloudUpload,
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
  "file-upload": FileUpload,
  "format-list-bulleted": FormatListBulleted,
  "fullscreen": Fullscreen,
  "group-work": GroupWork,
  "groups": Groups,
  "help-outline": HelpOutline,
  "history": History,
  "info": Info,
  "info-outline": InfoOutline,
  "insert-drive-file": InsertDriveFile,
  "inventory-2": Inventory2,
  "javascript": Javascript,
  "keyboard-arrow-down": KeyboardArrowDown,
  "keyboard-double-arrow-left": KeyboardDoubleArrowLeft,
  "keyboard-double-arrow-right": KeyboardDoubleArrowRight,
  "language": Language,
  "link": Link,
  "location-on": LocationOn,
  "more-vert": MoreVert,
  "navigate-before": NavigateBefore,
  "navigate-next": NavigateNext,
  "open-in-new": OpenInNew,
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
} as const satisfies Record<string, Component>;

export type IconName = keyof typeof iconRegistry;
