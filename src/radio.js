// VHF radio chatter: VTS (ch 14), bridge-to-bridge (ch 13), hailing/distress (ch 16), weather.
import { squelch } from './audio.js';
import { env, baseWindKn, tideLabel } from './env.js';
import { toLL } from './geo.js';

export const radio = { log: [], listeners: [] };
function where(v) {
  const { lat, lon } = toLL(v.x, v.z);
  if (lon < -122.465) return 'the Golden Gate Bridge';
  if (lat < 37.8 && lon > -122.39) return 'the Bay Bridge';
  if (Math.abs(lat - 37.827) < 0.01 && Math.abs(lon + 122.423) < 0.012) return 'Alcatraz';
  if (lat > 37.855 && lon < -122.44) return 'Raccoon Strait';
  if (lon > -122.38) return 'Treasure Island';
  return 'the Central Bay';
}
export function say(ch, from, text) {
  const m = { t: env.clock, ch, from, text };
  radio.log.push(m);
  if (radio.log.length > 60) radio.log.shift();
  squelch();
  for (const l of radio.listeners) l(m);
}
export function radioShip(kind, v, fresh) {
  if (kind === 'ship') {
    if (!fresh) return;
    const dest = v.lane === 1 ? 'Richmond Long Wharf' : 'Oakland Outer Harbor';
    if (v.outbound) say(14, v.name, `San Francisco Traffic, ${v.name}, departing ${dest}, outbound for sea. Will be passing under the Bay Bridge west span in about one-zero minutes. Pilot aboard.`);
    else say(14, v.name, `San Francisco Traffic, ${v.name}, inbound at the Golden Gate Bridge, bound ${dest}, one-two knots, pilot aboard.`);
    setTimeout(() => say(14, 'SF Traffic', `${v.name}, San Francisco Traffic, roger. Be advised: heavy recreational traffic, sailboat racing off the city front and in the central bay, numerous small craft.`), 3500);
  } else if (kind === 'shipcall') {
    say(13, v.name, `Small motor vessel near ${where(v)}, this is the ${v.name} on your ${Math.random() < 0.5 ? 'bow' : 'course line'}. I am a deep-draft vessel restricted to the channel. Please alter course and keep clear. ${v.name} out.`);
  }
}
export function radioFerry(v, what) {
  if (Math.random() > 0.5) return;
  say(13, v.name, `${v.name}, ${what}. Security call, all concerned traffic.`);
}
export function weather() {
  const w = baseWindKn(14.5);
  const sca = w >= 18;
  say('WX', 'NOAA Weather', `${sca ? 'Small craft advisory in effect from 1 PM to 9 PM PDT. ' : ''}San Francisco Bay north of the Bay Bridge: this afternoon west winds ${Math.round(w - 4)} to ${Math.round(w + 5)} knots. Wind waves ${w > 18 ? '2 to 3' : '1 to 2'} feet. Locally steep chop near the Golden Gate on the ebb. Tide now: ${tideLabel().toLowerCase()}.`);
}
const CHATTER = [
  () => say(16, 'Coast Guard', 'Securité, securité, securité. Coast Guard Sector San Francisco. A regatta is in progress off the San Francisco city front and the Berkeley circle. Mariners are requested to transit with caution. Sector San Francisco out.'),
  () => say(16, 'Coast Guard', 'Pan-pan, pan-pan, pan-pan. Coast Guard Sector San Francisco: a 22-foot vessel is disabled and adrift near Point Blunt, Angel Island. All vessels in the vicinity are requested to keep a sharp lookout and assist if possible.'),
  () => say(16, 'Sea Breeze', 'Sausalito Yacht Harbor, Sausalito Yacht Harbor, this is the sailing vessel Sea Breeze, requesting a guest slip for this afternoon. Switch one-six-eight? Over.'),
  () => say(13, 'Tug Revolution', 'Securité, securité. Tug REVOLUTION with tow astern, hawser 800 feet, crossing the central bay northbound east of Alcatraz, restricted in ability to maneuver. Concerned traffic contact on one-three.'),
  () => say(16, 'Island Time', 'Mayday— uh, correction, no emergency. Coast Guard, Island Time, radio check please.'),
  () => say(16, 'Coast Guard', 'Vessel calling for a radio check, this is Coast Guard Sector San Francisco. This is a distress and hailing channel; please use a working channel or an automated radio check. Out.'),
  () => say(14, 'SF Traffic', 'All stations, San Francisco Traffic. Two vessels underway in the Central Bay: one inbound Golden Gate for Oakland, one outbound from Oakland. Recreational vessels stay clear of the traffic lanes.'),
  () => say(13, 'Golden Gate Ferry', 'Golden Gate Ferry departing Larkspur for San Francisco, eastside of Angel Island. Security call.'),
  () => say(16, 'Marine Unit', 'All vessels near Aquatic Park: open-water swimmers in the area. Please reduce speed to no-wake and keep a sharp lookout.'),
];
let chatterT = 25;
export function updateRadio(dt) {
  chatterT -= dt;
  if (chatterT <= 0) { chatterT = 60 + Math.random() * 90; CHATTER[Math.floor(Math.random() * CHATTER.length)](); }
}
