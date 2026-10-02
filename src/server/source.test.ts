import { describe, expect, it } from 'vitest';

import { parseCatalog, parseCategories, parseDetail } from './source.js';

describe('xiaoyakankan parser', () => {
  it('extracts site categories', () => {
    const html = '<a href="/cat/10.html"><i></i><span>电影</span></a><a href="/cat/11.html">连续剧</a>';
    expect(parseCategories(html)).toEqual([
      { id: '10', name: '电影' },
      { id: '11', name: '连续剧' },
    ]);
  });

  it('extracts catalog cards', () => {
    const html = `<div class="item">
      <a class="link" href="/post/abc123def0.html">
        <img class="img" data-src="//i1.example/poster.jpg" alt="示例影片">
        <div class="tag1 r-1080p">1080p</div><div class="tag2">动作片 / 2026年</div>
      </a><div class="info"><a class="title">示例影片</a><div class="desc">演员甲 / 演员乙</div></div>`;
    expect(parseCatalog(html, 'https://xiaoyakankan.com')).toEqual([{
      id: 'abc123def0',
      title: '示例影片',
      poster: 'https://i1.example/poster.jpg',
      quality: '1080p',
      category: '动作片 / 2026年',
      description: '演员甲 / 演员乙',
    }]);
  });

  it('groups unique sources by episode', () => {
    const html = `
      <meta name="description" content="Example description">
      <div id="awp1" data-poster="//i.example/p.jpg" data-title="Example"></div>
      <div data-vod="1_2" class="source"><div class="list"><a data-sou_idx="0">第1集</a><a data-sou_idx="1">第2集</a></div></div>
      <script>var pp={"no":"abc123","lines":[["1_2","线路1",2,["https://v.example/1.m3u8","https://v.example/2.m3u8"]],["2_3","线路2",2,["https://v2.example/1.m3u8","https://v2.example/2.m3u8"]]]};</script>`;
    const detail = parseDetail(html, 'abc123', 'https://xiaoyakankan.com');
    expect(detail.title).toBe('Example');
    expect(detail.episodes).toHaveLength(2);
    expect(detail.episodes[0].label).toBe('第1集');
    expect(detail.episodes[0].sources).toHaveLength(2);
  });
});
