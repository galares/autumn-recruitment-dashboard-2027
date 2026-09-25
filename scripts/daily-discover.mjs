import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (name, fallback) => {
  try { return JSON.parse(await fs.readFile(path.join(root, name), 'utf8')); } catch { return fallback; }
};
const config = await readJson('monitor-sources.json', {official_pages: [], search_queries: []});
const jobs = await readJson('jobs.json', []);
const previous = await readJson('discoveries.json', []);
const previousByUrl = new Map(previous.map(item => [normalizeUrl(item.url), item]));
const knownUrls = new Set([...jobs, ...previous].map(item => normalizeUrl(item.url)).filter(Boolean));
const jobKey = (company = '', role = '') => `${company.replace(/[（）()\s]/g, '').toLowerCase()}|${role.replace(/2027|27届|校招|校园招聘|[（）()\s]/g, '').toLowerCase()}`;
const knownJobKeys = new Set([...jobs, ...previous].map(item => jobKey(item.company, item.role)));
const sourceResults = [];
const found = [];

const rolePattern = /(测试|验证|试验|应用工程|技术支持|质量|工艺|充电|电池|电控|整车|电机|电力电子|系统工程|研发工程)/i;
const graduatePattern = /(2027|27届|校园招聘|校招|应届|graduate|campus)/i;
const excludePattern = /(实习|internship|社招|经理|总监|销售代表)/i;

function decode(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2F;/g, '/').replace(/\s+/g, ' ').trim();
}
function normalizeUrl(value = '') {
  try { const url = new URL(value); url.hash = ''; ['utm_source','utm_medium','utm_campaign','spm'].forEach(key => url.searchParams.delete(key)); url.searchParams.sort(); return url.href.replace(/\/$/, ''); }
  catch { return ''; }
}
function absoluteUrl(href, base) { try { return new URL(decode(href), base).href; } catch { return ''; } }
function idFor(url) { return `AUTO-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 14)}`; }
function cityFrom(text) {
  const cities = ['上海','苏州','杭州','南京','无锡','常州','宁波','合肥','武汉','北京','广州','深圳'];
  return cities.filter(city => text.includes(city)).join('、') || '待核实';
}
function companyFrom(text, fallback = '待识别企业') {
  const companies = ['博世','采埃孚','舍弗勒','泰科电子','恩智浦','一汽-大众','吉利','零跑','理想汽车','汇川技术','联合动力','华测导航','春风动力','伟创电气','纳芯微'];
  return companies.find(company => text.includes(company)) || fallback;
}
function roleFrom(text, fallback) {
  const match = text.match(/[A-Za-z0-9\u4e00-\u9fa5（）()\/＋+·&-]{0,18}(?:测试工程师|验证工程师|试验工程师|应用工程师|技术支持工程师|质量工程师|工艺工程师|充电工程师|电池工程师|电控工程师|整车工程师|电机测试工程师|系统工程师|研发工程师)[A-Za-z0-9\u4e00-\u9fa5（）()\/＋+·&-]{0,12}/i);
  return match ? match[0] : fallback;
}
function candidate({company, title, url, summary, sourceName}) {
  const cleanUrl = normalizeUrl(url); const text = `${title} ${summary}`;
  if (!cleanUrl || knownUrls.has(cleanUrl) || !rolePattern.test(text) || excludePattern.test(text)) return null;
  if (!graduatePattern.test(text)) return null;
  const resolvedCompany = companyFrom(text, company); const resolvedRole = roleFrom(text, decode(title)).slice(0, 120);
  if (!rolePattern.test(resolvedRole) || knownJobKeys.has(jobKey(resolvedCompany, resolvedRole))) return null;
  return {
    id: idFor(cleanUrl), company: resolvedCompany, role: resolvedRole, city: cityFrom(text),
    kind: '每日自动发现线索', decision: '待核实', status: '待核实', auto_discovered: true,
    fit: '由每日监测发现；尚未完成人工匹配判断。',
    gaps: '需核验是否仍在招聘、2027届海外硕士毕业窗口、专业要求、技能门槛、薪资、截止日期和限投规则。',
    qualification: decode(summary).slice(0, 500) || '自动发现页面未提供完整任职要求。',
    salary: '待核实', deadline: null, deadline_note: '待核实', quota: '待核实',
    url: cleanUrl, sources: cleanUrl, resume: '待确定',
    next: '优先打开官方岗位页核验；自动发现线索不得直接视为符合或已投递。',
    discovered_at: new Date().toISOString(), source_name: sourceName, submitted_at: null, receipt: null
  };
}
async function fetchText(url) {
  const response = await fetch(url, {redirect: 'follow', signal: AbortSignal.timeout(20000), headers: {
    'user-agent': 'Mozilla/5.0 (compatible; ChenJieJobMonitor/1.0; +https://github.com/galares/autumn-recruitment-dashboard-2027)',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7'
  }});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

for (const source of config.official_pages || []) {
  const result = {name: source.company, url: source.url, ok: false, candidates: 0};
  try {
    const html = await fetchText(source.url);
    const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    for (const match of anchors) {
      const title = decode(match[2]); const url = absoluteUrl(match[1], source.url);
      const likelyJobLink = rolePattern.test(title) || /(job|position|apply|recruit)/i.test(url);
      if (!likelyJobLink) continue;
      const context = decode(html.slice(Math.max(0, (match.index || 0) - 450), (match.index || 0) + match[0].length + 450));
      const item = candidate({company: source.company, title: roleFrom(context, title), url, summary: `${source.campaign || ''} ${context}`, sourceName: source.company});
      if (item) { found.push(item); knownUrls.add(normalizeUrl(item.url)); knownJobKeys.add(jobKey(item.company, item.role)); result.candidates += 1; }
    }
    result.ok = true; result.detail = `${html.length} bytes`;
  } catch (error) { result.error = error.message; }
  sourceResults.push(result);
}

for (const query of config.search_queries || []) {
  const url = `https://www.bing.com/search?format=rss&setlang=zh-cn&q=${encodeURIComponent(query)}`;
  const result = {name: `Bing: ${query}`, url, ok: false, candidates: 0};
  try {
    const xml = await fetchText(url); const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    for (const itemMatch of items) {
      const block = itemMatch[1];
      const title = decode((block.match(/<title>([\s\S]*?)<\/title>/i) || [,''])[1]);
      const link = decode((block.match(/<link>([\s\S]*?)<\/link>/i) || [,''])[1]);
      const summary = decode((block.match(/<description>([\s\S]*?)<\/description>/i) || [,''])[1]);
      const item = candidate({company: '待识别企业', title, url: link, summary, sourceName: 'Bing RSS'});
      if (item) { found.push(item); knownUrls.add(normalizeUrl(item.url)); knownJobKeys.add(jobKey(item.company, item.role)); result.candidates += 1; }
    }
    result.ok = true; result.detail = `${items.length} results`;
  } catch (error) { result.error = error.message; }
  sourceResults.push(result);
}

const uniqueNew = [...new Map(found.map(item => [normalizeUrl(item.url), item])).values()].slice(0, 20);
const combined = [...uniqueNew, ...previous].reduce((map, item) => {
  const key = normalizeUrl(item.url); if (key && !map.has(key)) map.set(key, previousByUrl.get(key) || item); return map;
}, new Map());
const discoveries = [...combined.values()].slice(0, 100);
const now = new Date().toISOString();
await fs.writeFile(path.join(root, 'discoveries.json'), `${JSON.stringify(discoveries, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(root, 'monitor-status.json'), `${JSON.stringify({last_run: now, new_count: uniqueNew.length, total_candidates: discoveries.length, sources: sourceResults}, null, 2)}\n`, 'utf8');

const issueLines = uniqueNew.length ? uniqueNew.map(item => `- **${item.company}｜${item.role}｜${item.city}**\n  ${item.url}`).join('\n') : '本次未发现新的匹配线索。';
const issueBody = `每日自动监测发现 ${uniqueNew.length} 条新线索。所有线索均为“待核实”，尚未确认资格或投递。\n\n${issueLines}\n\n[打开秋招看板](https://galares.github.io/autumn-recruitment-dashboard-2027/)`;
await fs.writeFile(path.join(root, 'new-discoveries.md'), issueBody, 'utf8');
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `new_count=${uniqueNew.length}\n`, 'utf8');
console.log(JSON.stringify({new_count: uniqueNew.length, total: discoveries.length, sources_ok: sourceResults.filter(x => x.ok).length, sources_failed: sourceResults.filter(x => !x.ok).length}));
