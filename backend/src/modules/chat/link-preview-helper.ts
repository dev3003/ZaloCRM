import axios from 'axios';
import net from 'node:net';
import dns from 'node:dns/promises';

// List of sensitive keywords in hostname or pathname
const BLACKLISTED_KEYWORDS = [
  'aapanel', 'directadmin', 'cpanel', 'phpmyadmin', 
  'backup', 'localhost', 'env', 'config', 'setup',
  'solusvm', 'proxmox', 'virtualmin', 'webmin', 
  'cyberpanel', 'vestacp', 'plesk', 'adminer', 
  'phpredis', 'mongoclient'
];

/**
 * Checks if a given IP address belongs to local/private ranges (RFC 1918, IPv6 ULA, etc.).
 */
export function isPrivateIp(ip: string): boolean {
  // Check IPv4
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octet1 = parseInt(ipv4Match[1], 10);
    const octet2 = parseInt(ipv4Match[2], 10);
    
    // Loopback: 127.0.0.0/8
    if (octet1 === 127) return true;
    // Class A: 10.0.0.0/8
    if (octet1 === 10) return true;
    // Link-local: 169.254.0.0/16
    if (octet1 === 169 && octet2 === 254) return true;
    // Class B: 172.16.0.0/12
    if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return true;
    // Class C: 192.168.0.0/16
    if (octet1 === 192 && octet2 === 168) return true;
    // Unspecified: 0.0.0.0/8
    if (octet1 === 0) return true;
    // Multicast/Reserved
    if (octet1 >= 224) return true;
    
    return false;
  }

  // Check IPv6
  const ipv6 = ip.toLowerCase().trim();
  if (ipv6 === '::1' || ipv6 === '::') return true;
  // Link-local: fe80::/10
  if (ipv6.startsWith('fe80:')) return true;
  // Unique local address: fc00::/7
  if (ipv6.startsWith('fc') || ipv6.startsWith('fd')) return true;
  
  return false;
}

/**
 * Resolves a hostname to an IP address.
 */
export async function resolveHostIp(host: string): Promise<string | null> {
  try {
    const lookup = await dns.lookup(host);
    return lookup.address;
  } catch {
    return null;
  }
}

interface CacheEntry {
  data: { title: string; description: string; image: string; url: string } | null;
  expiresAt: number;
}

const PREVIEW_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Scrapes a URL securely and returns Open Graph details.
 */
export async function getSafeLinkPreview(urlString: string): Promise<{ title: string; description: string; image: string; url: string } | null> {
  const cacheKey = urlString.trim();
  
  // Check Cache
  const cached = PREVIEW_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const url = new URL(urlString);
    
    // 1. Only allow http and https
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    
    // 2. Only allow port 80/443 or empty
    if (url.port && url.port !== '80' && url.port !== '443') {
      return null;
    }
    
    const host = url.hostname;
    
    // 3. Check keywords
    const hostLower = host.toLowerCase();
    for (const kw of BLACKLISTED_KEYWORDS) {
      if (hostLower.includes(kw) || url.pathname.toLowerCase().includes(kw)) {
        return null;
      }
    }
    
    // 4. Resolve IP & Validate against private/local networks
    let targetIp = '';
    if (net.isIP(host)) {
      targetIp = host;
    } else {
      const resolved = await resolveHostIp(host);
      if (!resolved) return null;
      targetIp = resolved;
    }
    
    if (isPrivateIp(targetIp)) {
      return null;
    }
    
    // 5. Perform safe fetch with redirection checking
    let currentUrl = urlString;
    let redirectsCount = 0;
    const maxRedirects = 2;
    let htmlContent = '';
    
    while (redirectsCount <= maxRedirects) {
      const curUrlObj = new URL(currentUrl);
      
      // Safety check the redirect URL
      if (curUrlObj.protocol !== 'http:' && curUrlObj.protocol !== 'https:') return null;
      if (curUrlObj.port && curUrlObj.port !== '80' && curUrlObj.port !== '443') return null;
      
      const curHost = curUrlObj.hostname;
      for (const kw of BLACKLISTED_KEYWORDS) {
        if (curHost.toLowerCase().includes(kw) || curUrlObj.pathname.toLowerCase().includes(kw)) {
          return null;
        }
      }
      
      let curIp = '';
      if (net.isIP(curHost)) {
        curIp = curHost;
      } else {
        const resolved = await resolveHostIp(curHost);
        if (!resolved) return null;
        curIp = resolved;
      }
      
      if (isPrivateIp(curIp)) {
        return null;
      }
      
      const response = await axios.get(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        timeout: 2500,
        maxRedirects: 0, // Manual redirection handling
        maxContentLength: 1024 * 1024 * 2, // max 2MB HTML
        responseType: 'text',
        validateStatus: (status) => status >= 200 && status < 400,
      });
      
      if (response.status >= 300 && response.status < 400) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) break;
        
        // Resolve absolute URL
        currentUrl = new URL(redirectUrl, currentUrl).toString();
        redirectsCount++;
      } else {
        htmlContent = response.data;
        break;
      }
    }
    
    if (!htmlContent) return null;
    
    // 6. Parse metadata via Regexes
    const title = extractMeta(htmlContent, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title>([^<]+)<\/title>/i
    ]);
    
    const description = extractMeta(htmlContent, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i
    ]);
    
    const image = extractMeta(htmlContent, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
    ]);
    
    // Resolve absolute image URL if it's relative
    let absoluteImage = image;
    if (image && !image.startsWith('http')) {
      try {
        absoluteImage = new URL(image, currentUrl).toString();
      } catch {}
    }
    
    const result = {
      title: title || new URL(currentUrl).hostname,
      description: description || '',
      image: absoluteImage || '',
      url: currentUrl
    };
    PREVIEW_CACHE.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    PREVIEW_CACHE.set(cacheKey, { data: null, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
    return null;
  }
}

function extractMeta(html: string, regexes: RegExp[]): string {
  for (const regex of regexes) {
    const match = html.match(regex);
    if (match && match[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }
  return '';
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
