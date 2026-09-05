// Socle d'execution des extensions — copie fidele de celui que l'app injecte.
//
// POURQUOI ce fichier existe : le harnais definissait autrefois son propre socle
// ou chaque methode levait "NI". L'app, elle, fournit un vrai pont entre les deux
// dialectes (MProvider <-> LNProvider) avec conversion des champs. Le harnais
// mesurait donc autre chose que ce que le telephone execute, et une extension
// pouvait passer ici puis rendre une page blanche sur l'appareil.
//
// SOURCE DE VERITE : Hitomi/lib/data/extensions/runtime/m_provider_wrapper.dart,
// la chaine `_baseClassesJs`. Toute modification du pont cote app doit etre
// reportee ici, sinon le harnais redevient un menteur.
// Aligne le 2026-09-04 sur la revision dc11707 de la branche dev.

const RUNTIME_BASE_JS = `
class MProvider {
  get name() { return ""; }
  get lang() { return ""; }
  get baseUrl() { return ""; }
  get supportsLatest() { return false; }
  get isMature() { return false; }
  get hasCloudflare() { return false; }
  get contentType() { return "manga"; }

  async getPopular(page) { throw new Error("getPopular not implemented"); }
  async getLatestUpdates(page) { throw new Error("getLatestUpdates not implemented"); }
  async search(query, page, filters) { throw new Error("search not implemented"); }
  async getMangaDetail(url) { throw new Error("getMangaDetail not implemented"); }
  async getChapterList(url) { throw new Error("getChapterList not implemented"); }
  async getPageList(url) { throw new Error("getPageList not implemented"); }
  async getHtmlContent(name, url) { return ""; }
  getFilterList() { return []; }

  async popularNovels(page) {
    var result = await this.getPopular(page);
    var list = [];
    if (result && result.list) {
      for (var i = 0; i < result.list.length; i++) {
        var item = result.list[i];
        list.push({
          title: item.title,
          url: item.url,
          cover: item.imageUrl || '',
          isMature: item.isMature || false,
          genres: Array.isArray(item.genres) ? item.genres : [],
        });
      }
    }
    return { list: list, hasNextPage: result ? result.hasNextPage : false };
  }

  async searchNovels(searchTerm, page) {
    var result = await this.search(searchTerm, page, []);
    var list = [];
    if (result && result.list) {
      for (var i = 0; i < result.list.length; i++) {
        var item = result.list[i];
        list.push({
          title: item.title,
          url: item.url,
          cover: item.imageUrl || '',
          isMature: item.isMature || false,
          genres: Array.isArray(item.genres) ? item.genres : [],
        });
      }
    }
    return { list: list, hasNextPage: result ? result.hasNextPage : false };
  }

  async parseNovelAndChapters(url) {
    var detail = await this.getMangaDetail(url);
    var chapters = await this.getChapterList(url);
    var lnChapters = [];
    if (chapters) {
      for (var i = 0; i < chapters.length; i++) {
        var ch = chapters[i];
        lnChapters.push({
          name: ch.title,
          url: ch.url,
          chapterNumber: ch.number || 0,
          releaseTime: ch.dateUpload ? new Date(ch.dateUpload).toISOString() : '',
        });
      }
    }
    return {
      title: detail.title || '',
      url: detail.url || url,
      cover: detail.imageUrl || '',
      author: (detail.authors && detail.authors.length > 0) ? detail.authors[0] : '',
      description: detail.description || '',
      status: detail.status || '',
      genres: detail.genres || [],
      isMature: detail.isMature || false,
      chapters: lnChapters,
    };
  }

  async parseChapter(url) {
    if (typeof this.getContent === 'function') {
      return await this.getContent(url);
    }
    return await this.getHtmlContent('', url);
  }

  async getCustomCSS() { return ""; }
}

class LNProvider {
  get id()      { return ""; }
  get name()    { return ""; }
  get lang()    { return ""; }
  get baseUrl() { return ""; }
  get iconUrl() { return ""; }
  get supportsLatest() { return false; }
  get isMature() { return false; }
  get hasCloudflare() { return false; }

  async popularNovels(page)            { throw new Error("popularNovels not implemented"); }
  async parseNovelAndChapters(url)     { throw new Error("parseNovelAndChapters not implemented"); }
  async parseChapter(url)              { throw new Error("parseChapter not implemented"); }
  async searchNovels(searchTerm, page) { throw new Error("searchNovels not implemented"); }
  getFilterList() { return []; }

  async getPopular(page) {
    var result = await this.popularNovels(page);
    var list = [];
    if (result && result.list) {
      for (var i = 0; i < result.list.length; i++) {
        var item = result.list[i];
        list.push({
          title: item.title,
          url: item.url,
          imageUrl: item.cover || '',
          isMature: item.isMature || false,
          genres: Array.isArray(item.genres) ? item.genres : [],
        });
      }
    }
    return { list: list, hasNextPage: result ? result.hasNextPage : false };
  }

  async getLatestUpdates(page) { return this.getPopular(page); }

  async search(query, page, filters) {
    var result = await this.searchNovels(query, page);
    var list = [];
    if (result && result.list) {
      for (var i = 0; i < result.list.length; i++) {
        var item = result.list[i];
        list.push({
          title: item.title,
          url: item.url,
          imageUrl: item.cover || '',
          isMature: item.isMature || false,
          genres: Array.isArray(item.genres) ? item.genres : [],
        });
      }
    }
    return { list: list, hasNextPage: result ? result.hasNextPage : false };
  }

  async getMangaDetail(url) { return this.parseNovelAndChapters(url); }
  async getChapterList(url) {
    var detail = await this.parseNovelAndChapters(url);
    var chapters = [];
    if (detail && detail.chapters) {
      for (var i = 0; i < detail.chapters.length; i++) {
        var ch = detail.chapters[i];
        chapters.push({ title: ch.name, url: ch.url, number: ch.chapterNumber || 0, dateUpload: 0 });
      }
    }
    return chapters;
  }
  async getPageList(url) { return []; }
  async getHtmlContent(name, url) { return this.parseChapter(url); }

  async getCustomCSS() { return ""; }
}
`;

module.exports = { RUNTIME_BASE_JS };
