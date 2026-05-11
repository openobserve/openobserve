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

import Alarm from "~icons/material-symbols-light/alarm-outline";
import Add from "~icons/material-symbols-light/add";
import ArrowBack from "~icons/material-symbols-light/arrow-back";
import ArrowBackIosNew from "~icons/material-symbols-light/arrow-back-ios-new";
import ArrowDownward from "~icons/material-symbols-light/arrow-downward";
import ArrowDropDown from "~icons/material-symbols-light/arrow-drop-down";
import ArrowForward from "~icons/material-symbols-light/arrow-forward";
import ArrowUpward from "~icons/material-symbols-light/arrow-upward";
import Article from "~icons/material-symbols-light/article-outline";
import Attachment from "~icons/material-symbols-light/attachment";
import Stars from "~icons/material-symbols-light/stars-outline";
import Backpack from "~icons/material-symbols-light/backpack-outline";
import Block from "~icons/material-symbols-light/block-outline";
import Bolt from "~icons/material-symbols-light/bolt-outline";
import Cached from "~icons/material-symbols-light/cached";
import CalendarMonth from "~icons/material-symbols-light/calendar-month-outline";
import Campaign from "~icons/material-symbols-light/campaign-outline";
import Cancel from "~icons/material-symbols-light/cancel-outline";
import Redeem from "~icons/material-symbols-light/redeem";
import Category from "~icons/material-symbols-light/category-outline";
import Check from "~icons/material-symbols-light/check";
import CheckCircle from "~icons/material-symbols-light/check-circle-outline";
import ChevronLeft from "~icons/material-symbols-light/chevron-left";
import ChevronRight from "~icons/material-symbols-light/chevron-right";
import Close from "~icons/material-symbols-light/close";
import Backup from "~icons/material-symbols-light/backup-outline";
import Cloud from "~icons/material-symbols-light/cloud-outline";
import Code from "~icons/material-symbols-light/code";
import CompareArrows from "~icons/material-symbols-light/compare-arrows";
import ContentCopy from "~icons/material-symbols-light/content-copy-outline";
import Delete from "~icons/material-symbols-light/delete-outline";
import Download from "~icons/material-symbols-light/download";
import Edit from "~icons/material-symbols-light/edit-outline";
import Error from "~icons/material-symbols-light/error-outline";
import ErrorOutline from "~icons/material-symbols-light/error-outline";
import Event from "~icons/material-symbols-light/event-outline";
import ExpandMore from "~icons/material-symbols-light/expand-more";
import UploadFile from "~icons/material-symbols-light/upload-file-outline";
import FormatListBulleted from "~icons/material-symbols-light/format-list-bulleted";
import Fullscreen from "~icons/material-symbols-light/fullscreen";
import GroupWork from "~icons/material-symbols-light/group-work-outline";
import Groups from "~icons/material-symbols-light/groups-outline";
import HelpOutline from "~icons/material-symbols-light/help-outline";
import History from "~icons/material-symbols-light/history";
import Info from "~icons/material-symbols-light/info-outline";
import InfoOutline from "~icons/material-symbols-light/info-outline";
import Draft from "~icons/material-symbols-light/draft-outline";
import Inventory2 from "~icons/material-symbols-light/inventory-2-outline";
import Javascript from "~icons/material-symbols-light/javascript";
import KeyboardArrowDown from "~icons/material-symbols-light/keyboard-arrow-down";
import KeyboardDoubleArrowLeft from "~icons/material-symbols-light/keyboard-double-arrow-left";
import KeyboardDoubleArrowRight from "~icons/material-symbols-light/keyboard-double-arrow-right";
import Language from "~icons/material-symbols-light/language";
import Link from "~icons/material-symbols-light/link";
import LocationOn from "~icons/material-symbols-light/location-on-outline";
import MoreVert from "~icons/material-symbols-light/more-vert";
import OpenInNew from "~icons/material-symbols-light/open-in-new";
import Person from "~icons/material-symbols-light/person-outline";
import PlayArrow from "~icons/material-symbols-light/play-arrow-outline";
import Preview from "~icons/material-symbols-light/preview-outline";
import QueryStats from "~icons/material-symbols-light/query-stats";
import Refresh from "~icons/material-symbols-light/refresh";
import Replay from "~icons/material-symbols-light/replay";
import Schedule from "~icons/material-symbols-light/schedule-outline";
import Search from "~icons/material-symbols-light/search";
import Send from "~icons/material-symbols-light/send-outline";
import Share from "~icons/material-symbols-light/share-outline";
import Settings from "~icons/material-symbols-light/settings-outline";
import Shield from "~icons/material-symbols-light/shield-outline";
import ShowChart from "~icons/material-symbols-light/show-chart";
import Timeline from "~icons/material-symbols-light/timeline";
import Tune from "~icons/material-symbols-light/tune";
import Visibility from "~icons/material-symbols-light/visibility-outline";
import VisibilityOff from "~icons/material-symbols-light/visibility-off-outline";
import Warning from "~icons/material-symbols-light/warning-outline";
import Workspaces from "~icons/material-symbols-light/workspaces-outline";
import WorkspacePremium from "~icons/material-symbols-light/workspace-premium-outline";

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
  "draft": Draft,
  "inventory-2": Inventory2,
  "javascript": Javascript,
  "keyboard-arrow-down": KeyboardArrowDown,
  "keyboard-double-arrow-left": KeyboardDoubleArrowLeft,
  "keyboard-double-arrow-right": KeyboardDoubleArrowRight,
  "language": Language,
  "link": Link,
  "location-on": LocationOn,
  "more-vert": MoreVert,
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
