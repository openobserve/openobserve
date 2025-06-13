import {cloneLayout, compact, correctBounds} from "./utils"

import type {Layout} from "./utils"
export type ResponsiveLayout = {lg?: Layout; md?: Layout; sm?: Layout; xs?: Layout; xxs?: Layout}
export type Breakpoint = string
export type Breakpoints = {lg?: number; md?: number; sm?: number; xs?: number; xxs?: number}

/**
 * Given a width, find the highest breakpoint that matches is valid for it (width > breakpoint).
 *
 * @param  {Object} breakpoints Breakpoints object (e.g. {lg: 1200, md: 960, ...})
 * @param  {Number} width Screen width.
 * @return {String}       Highest breakpoint that is less than width.
 */
export function getBreakpointFromWidth(breakpoints: Breakpoints, width: number): Breakpoint {
  const sorted = sortBreakpoints(breakpoints)
  let matching = sorted[0]
  for (let i = 1, len = sorted.length; i < len; i++) {
    const breakpointName = sorted[i]
    if (width > breakpoints[breakpointName]) matching = breakpointName
  }
  return matching
}

/**
 * Given a breakpoint, get the # of cols set for it.
 * @param  {String} breakpoint Breakpoint name.
 * @param  {Object} cols       Map of breakpoints to cols.
 * @return {Number}            Number of cols.
 */
export function getColsFromBreakpoint(breakpoint: Breakpoint, cols: Breakpoints): number {
  if (!cols[breakpoint]) {
    throw new Error(
      "ResponsiveGridLayout: `cols` entry for breakpoint " + breakpoint + " is missing!"
    )
  }
  return cols[breakpoint]
}

/**
 * Given existing layouts and a new breakpoint, find or generate a new layout.
 *
 * This finds the layout above the new one and generates from it, if it exists.
 *
 * @param  {Array} orgLayout     Original layout.
 * @param  {Object} layouts     Existing layouts.
 * @param  {Array} breakpoints All breakpoints.
 * @param  {String} breakpoint New breakpoint.
 * @param  {String} breakpoint Last breakpoint (for fallback).
 * @param  {Number} cols       Column count at new breakpoint.
 * @param  {Boolean} verticalCompact Whether or not to compact the layout
 *   vertically.
 * @return {Array}             New layout.
 */
export function findOrGenerateResponsiveLayout(
  orgLayout: Layout,
  layouts: ResponsiveLayout,
  breakpoints: Breakpoints,
  breakpoint: Breakpoint,
  lastBreakpoint: Breakpoint,
  cols: number,
  verticalCompact: boolean
): Layout {
  // If it already exists, just return it.
  if (layouts[breakpoint]) return cloneLayout(layouts[breakpoint])
  // Find or generate the next layout
  let layout = orgLayout

  const breakpointsSorted = sortBreakpoints(breakpoints)
  const breakpointsAbove = breakpointsSorted.slice(breakpointsSorted.indexOf(breakpoint))
  for (let i = 0, len = breakpointsAbove.length; i < len; i++) {
    const b = breakpointsAbove[i]
    if (layouts[b]) {
      layout = layouts[b]
      break
    }
  }
  layout = cloneLayout(layout || []) // clone layout so we don't modify existing items
  return compact(correctBounds(layout, {cols: cols}), verticalCompact)
}

export function generateResponsiveLayout(
  layout: Layout,
  breakpoints: Breakpoints,
  breakpoint: Breakpoint,
  lastBreakpoint: Breakpoint,
  cols: number,
  verticalCompact: boolean
): Layout {
  // If it already exists, just return it.
  /*if (layouts[breakpoint]) return cloneLayout(layouts[breakpoint]);
  // Find or generate the next layout
  let layout = layouts[lastBreakpoint];*/
  /*const breakpointsSorted = sortBreakpoints(breakpoints);
  const breakpointsAbove = breakpointsSorted.slice(breakpointsSorted.indexOf(breakpoint));
  for (let i = 0, len = breakpointsAbove.length; i < len; i++) {
    const b = breakpointsAbove[i];
    if (layouts[b]) {
      layout = layouts[b];
      break;
    }
  }*/
  layout = cloneLayout(layout || []) // clone layout so we don't modify existing items
  return compact(correctBounds(layout, {cols: cols}), verticalCompact)
}

/**
 * Given breakpoints, return an array of breakpoints sorted by width. This is usually
 * e.g. ['xxs', 'xs', 'sm', ...]
 *
 * @param  {Object} breakpoints Key/value pair of breakpoint names to widths.
 * @return {Array}              Sorted breakpoints.
 */
export function sortBreakpoints(breakpoints: Breakpoints): Array<Breakpoint> {
  const keys: Array<string> = Object.keys(breakpoints)
  return keys.sort(function (a, b) {
    return breakpoints[a] - breakpoints[b]
  })
}
