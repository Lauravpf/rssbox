function pad(s) {
  return ("0"+s).slice(-2);
}

function sign(n) {
  if (n < 0) {
    return "-";
  }
  if (n > 0) {
    return "+";
  }
  return "";
}

function fmt_filesize(bytes, digits=1) {
  const units = ["B", "kiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let i = 0;
  while (bytes > 1024 && i < units.length) {
    bytes = bytes / 1024;
    i++;
  }
  if (i < 2) digits = 0;
  const size = (i > 0) ? bytes.toFixed(digits) : bytes;
  return `${size} ${units[i]}`;
}

function toObject(arr, f=decodeURIComponent) {
  const obj = {};
  arr.forEach(function(e) {
    obj[e[0]] = f(e[1]);
  });
  return obj;
}

function basename(url) {
  url = url.substr(0, url.indexOf("?")) || url;
  url = url.substr(0, url.indexOf("#")) || url;
  return url.substr(url.lastIndexOf("/")+1);
}

$(document).ready(function() {
  window.dirty = 0;
  $(window).on("beforeunload", function(event) {
    if (window.dirty > 0) {
      event.preventDefault();
      event.returnValue = "There are still files downloading!";
      return event.returnValue;
    }
  });

  $(document).on("show.bs.dropdown", function(e) {
    const form = $(e.target).parents("form");
    const q = form.find("input[name=q]").val();
    form.find("[data-download]").each(function() {
      const btn = $(this);
      const val = btn.attr("data-download");
      let url = `${form.attr("action")}/download?url=${q}`;
      if (val) {
        url += `&type=${val}`;
      }
      btn.attr("href", url);
    });
    form.find("[data-action]").each(function() {
      const btn = $(this);
      btn.attr("href", `${form.attr("action")}/${btn.attr("data-action")}?url=${q}`);
    });
    form.find("[data-vlc]").each(function() {
      const btn = $(this);
      btn.attr("href", `vlc://${form[0].action}/${btn.attr("data-vlc")}?url=${q}`);
    });
    form.find("[data-irc]").each(function() {
      const btn = $(this);
      const m = /(?:https?:\/\/(?:www\.|clips\.)?twitch\.tv\/)?([^/]+)/.exec(q);
      if (m == null) {
        return;
      }
      const channel = m[1];
      btn.attr("href", `irc://${btn.attr("data-irc")}/${channel}`);
    });
  });

  $("form[method=get]").submit(async function(event) {
    event.preventDefault();

    const form = $(this);
    const action = form.attr("action");
    const qs = form.serialize();
    form.find("[name=type]").detach();

    const submit = form.find('input[type="submit"]');
    submit.attr("data-original-value", submit.attr("value"));
    submit.attr("value", "Working...");
    form.find("input").prop("disabled", true);

    const response = await fetch(`${action}?${qs}`, {
      headers: {
        "Accept": "application/json",
      },
    });
    submit.attr("value", submit.attr("data-original-value"));
    form.find("input").prop("disabled", false);
    if (!response.ok) {
      alert(await response.text());
      return;
    }

    let url;
    if (response.redirected) {
      url = response.url;
    }
    else {
      const data = await response.json();
      if (data.startsWith("/")) {
        // local feed
        let pathname = window.location.pathname;
        if (pathname.endsWith("/")) {
          pathname = pathname.substr(0, pathname.length-1);
        }
        url = `${window.location.protocol}//${window.location.host}${pathname}${data}`;
        // initiate a request just to get a head start on resolving urls
        fetch(url);
      }
      else {
        // external feed
        url = data;
      }
    }
    $("#feed-url").val(url);
    $("#feed-modal").modal("show");
    $("#feed-url").select();
  });

  $("#copy-button").click(function() {
    $("#feed-url").select();
    document.execCommand("copy");
  });

  $("[data-submit-type]").click(function() {
    const form = $(this).parents("form");
    const val = $(this).attr("data-submit-type");
    $('<input type="hidden" name="type">').val(val).insertAfter(this);
    form.submit();
  });
  $(window).bind("pageshow", function() {
    $("[name=type]").detach(); // remove type inputs which remain when using the back button
  });

  $("[data-download-filename]").click(async function() {
    const form = $(this).parents("form");
    const q = form.find("input[name=q]").val();
    if (q == "") {
      alert("Please enter a URL.");
      return;
    }

    const response = await fetch(`${form.attr("action")}/download?url=${q}`, {
      headers: {
        "Accept": "application/json",
      },
    });
    if (!response.ok) {
      alert(response.text());
      return;
    }
    let data = await response.json();
    if (data.constructor != Array) {
      data = [data];
    }

    data.forEach(async (file, i) => {
      if (file.live) {
        $(`<div><p><tt>ffmpeg -i "${file.url}" "${file.filename}"</tt></p></div>`).insertAfter(form);
        return;
      }

      // this is a big hack for cross-origin <a download="filename">
      window.dirty++;
      const controller = new AbortController();
      const progress = document.createElement("progress");
      progress.title = file.filename;
      $(progress).click(function() {
        if (confirm(`Abort download of "${file.filename}"?`)) {
          controller.abort();
          window.dirty--;
          $(this).off("click");
        }
      });
      $(progress).insertAfter(form);

      const response = await fetch(file.url, {
        signal: controller.signal,
      });
      if (!response.ok) {
        alert(await response.text());
        return;
      }
      progress.max = parseInt(response.headers.get("Content-Length"), 10);

      const reader = response.body.getReader();
      const parts = [];
      while (true) {
        const {value, done} = await reader.read();
        console.log(i, value?.length, done);
        if (done) {
          break;
        }
        parts.push(value);
        progress.value += value.length;
        progress.title = `${fmt_filesize(progress.value)} / ${fmt_filesize(progress.max)} (${(progress.value/progress.max*100).toFixed(1)}%) of ${file.filename}`;
      }

      const blob = new Blob(parts);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        window.dirty--;
      }, 100);
    });
  });

  const tz_offset = -new Date().getTimezoneOffset();
  if (tz_offset != 0) {
    $("form[action=youtube]").append($('<input type="hidden" name="tz">').val(`${sign(tz_offset)}${pad(Math.abs(tz_offset/60))}:${pad(Math.abs(tz_offset%60))}`));
  }

  const params = toObject(window.location.search.substr(1).split("&").map((arg) => arg.split("=")));
  if (params.q) {
    $('input[type="search"]').val(params.q);
  }
  if (params.download) {
    const m = /([a-z]+)\.[^./]+\//.exec(params.download);
    if (m) {
      const input = $(`#${m[1]}_q`);
      if (input) {
        input.val(params.download);
        input.parents("form").find("[data-download-filename]").click();
        input[0].scrollIntoView({ block: "center" });
      }
    }
  }
});
