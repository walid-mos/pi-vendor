/**
 * Which addresses fetch_content may connect to: public unicast only. Local, private, shared (the tailnet's CGNAT range
 * included), link-local, documentation, benchmarking, multicast and reserved ranges are refused, so a page cannot make
 * Pi read a machine of the LAN, the tailnet or a cloud metadata service.
 */

import { BlockList, isIP } from "node:net";

const IPV4_BLOCKED = [
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.88.99.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
];

const IPV6_BLOCKED = [
	// The unspecified and loopback addresses, and the deprecated IPv4-compatible ones (::a.b.c.d).
	"::/96",
	// The deprecated IPv4-translated ones (::ffff:0:a.b.c.d); IPv4-mapped ones (::ffff:a.b.c.d) are checked as IPv4.
	"::ffff:0:0:0/96",
	"64:ff9b::/96",
	"64:ff9b:1::/48",
	"100::/64",
	"2001::/23",
	"2001:db8::/32",
	"2002::/16",
	"3fff::/20",
	"fc00::/7",
	"fe80::/10",
	// Deprecated site-local addresses.
	"fec0::/10",
	"ff00::/8",
];

const blocked = new BlockList();
for (const range of IPV4_BLOCKED) addSubnet(range, "ipv4");
for (const range of IPV6_BLOCKED) addSubnet(range, "ipv6");

function addSubnet(range: string, type: "ipv4" | "ipv6"): void {
	const [network, prefix] = range.split("/");
	blocked.addSubnet(network, Number(prefix), type);
}

/**
 * True when `ip` is a public address. Throws on anything that is not an IP literal as `isIP` reads it (a host name,
 * `127.1`, a bracketed address): the caller resolves and normalizes first, because a guess would be a hidden verdict.
 * BlockList checks an IPv4-mapped IPv6 address against the IPv4 ranges.
 */
export function isPublicAddress(ip: string): boolean {
	const version = isIP(ip);
	if (version === 0) throw new Error(`not an IP address: ${ip}`);
	return !blocked.check(ip, version === 4 ? "ipv4" : "ipv6");
}
