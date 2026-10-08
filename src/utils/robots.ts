// How the robots bid, for a robot's profile sheet (#203): the short version
// of bridge_backend docs/ROBOTS.md, Bidding. Static text: the system is the
// backend's, and changes there are copied here by hand.

export const ROBOT_SYSTEM_TITLE = 'How robots bid';

export const ROBOT_SYSTEM: readonly string[] = [
  'SAYC-style, with five-card majors',
  '15–17 1NT',
  'Strong 2♣ and weak twos',
  'Stayman and Jacoby transfers',
  'Takeout and negative doubles',
  'Blackwood and Gerber',
];

export const ROBOT_ALERTS_NOTE = "Special calls are alerted, to you too when you're its partner.";
