// Developer term -> UI label. The README glossary is the source of truth; keep them in sync.
export const labels = {
  planningPhase: 'Route Planner',
  itineraryDraft: 'Draft',
  lockedItinerary: 'The Route',
  approvalVote: 'Highball',
  like: 'Cheers',
  dislike: 'Pass',
  livePhase: 'Live',
  wrapUpPhase: 'Closing Time',
  admin: 'Conductor',
  users: 'Crew',
  userRoster: 'Crew Board',
  stop: 'Stop',
  dwell: 'Layover',
  trainLeg: 'Run',
  walk: 'Walk',
  venueCard: 'Stop card',
  departureBanner: 'Departure Board',
  firstWarning: 'Last Call',
  leaveNow: 'All Aboard',
  locationSharing: 'Position Report',
  checkIn: 'Punch',
  reroute: 'Reroute',
  hold: 'Hold',
  cancelStop: 'Annul',
  addStop: 'Extra',
  broadcast: 'Bulletin',
  eventLog: 'Train Sheet',
  drinkLog: 'Tab',
  scoreboard: 'Hall of Fame',
  awards: 'Golden Spikes',
  media: 'Freight',
  album: 'Roundhouse',
  simulationMode: 'Shakedown Run',
  simulationClock: 'Railroad Time',
  meetingPoint: 'Meet Point',
  straggler: 'Caboose',
  leftEarly: 'Deadhead',
  homeStation: 'Home Terminal'
} as const;

export type LabelKey = keyof typeof labels;

export function label(key: LabelKey): string {
  return labels[key];
}

// UI copy lives alongside the glossary so it can be changed in one place.
export const copy = {
  appTitle: 'Chug-a-Lug Choo-Choo',
  appSubtitle: 'Your next stop starts here.',
  loginTitle: 'Welcome aboard',
  loginIntro: 'Enter your name and the crew password from the family chat.',
  name: 'Your name',
  namePlaceholder: 'How the crew knows you',
  password: 'Crew password',
  login: 'Climb aboard',
  working: 'Please wait…',
  nameError: "Enter a name: 2 to 32 letters, numbers, spaces, or . ' -",
  passwordError: 'Enter the crew password.',
  genericError: 'Something went wrong. Please try again.',
  welcome: 'Welcome aboard,',
  role: 'You are part of the',
  comingSoon: 'Coming soon',
  homeIntro: 'You’re ready for the ride. Planning, live updates, and the album will arrive next.',
  notYou: 'Not you? Log out and enter your own name.',
  logout: 'Log out',
  footer: 'Family, friends, and the next train.',
} as const;
