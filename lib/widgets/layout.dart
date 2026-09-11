import 'package:flutter/material.dart';

/// Screens whose shortest side is at least this many logical pixels are
/// laid out as tablets: they get the All tab, and in landscape they show a
/// post beside its list instead of on a new screen.
const double tabletBreakpoint = 600;

bool isTablet(BuildContext context) =>
    MediaQuery.sizeOf(context).shortestSide >= tabletBreakpoint;

/// A tablet held sideways: wide enough for a list and a post side by side.
bool isLandscapeTablet(BuildContext context) =>
    isTablet(context) &&
    MediaQuery.orientationOf(context) == Orientation.landscape;
