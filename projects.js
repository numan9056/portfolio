// Shared by the home page, the gallery and the project page.
(function () {
  'use strict';

  var CAT_LABEL = {
    'case':   'Case Study',
    ui:       'UI Design',
    graphic:  'Graphic Design',
    branding: 'Branding',
    campaign: 'Campaign Design'
  };

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Stable address for a project. Older projects have no id, so use their image name.
  function projectId(p, index) {
    if (p.id) return p.id;
    var m = /[?&]key=([^&]+)/.exec(p.image || '') || /([^\/]+)$/.exec(p.image || '');
    return m ? decodeURIComponent(m[1]).replace(/\.\w+$/, '') : String(index);
  }

  function projectUrl(p, index) {
    return 'project-detail.html?id=' + encodeURIComponent(projectId(p, index));
  }

  // Published projects: live API first (Netlify Blobs), static JSON as a fallback for local dev.
  function load() {
    var jsonUrl = 'data/projects.json?v=' + Date.now();
    return fetch('/api/admin?action=projects')
      .then(function(r) { return r.ok ? r.json() : fetch(jsonUrl).then(function(r2) { return r2.json(); }); })
      .catch(function() { return fetch(jsonUrl).then(function(r) { return r.json(); }); })
      .then(function(data) {
        return (data.projects || []).filter(function(p) { return p.published !== false; });
      });
  }

  window.Projects = {
    CAT_LABEL:  CAT_LABEL,
    escHtml:    escHtml,
    projectId:  projectId,
    projectUrl: projectUrl,
    load:       load
  };
})();
