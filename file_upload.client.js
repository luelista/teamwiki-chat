// polyfill for google chrome
if(!XMLHttpRequest.prototype.sendAsBinary) {
  XMLHttpRequest.prototype.sendAsBinary = function(datastr) {
    function byteValue(x) {
      return x.charCodeAt(0) & 0xff;
    }
    var ords = Array.prototype.map.call(datastr, byteValue);
    var ui8a = new Uint8Array(ords);
    this.send(ui8a.buffer);
  }
}
jQuery.event.props.push('dataTransfer');
$(function() {
  $("body").on('dragover', function(e) {
    e.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
  }).on('drop', function(e) {
    var files = e.dataTransfer ? e.dataTransfer.files : e.target.files; // FileList object.
    for (var i = 0, f; f = files[i]; i++) {
      uploadFileAsAttachment(f, f.name); return false;
    }
    return false;
  });
  window.document.onpaste = function(e){
    var f = e.clipboardData.items[0].getAsFile();
    if (f.type && f.type.substr(0,5) == 'image') {
      uploadFileAsAttachment(f, "paste.png");
    }
  }
});
window.uploadFileAsAttachment=function(theFile,filename) {
  var $stat = $("#statusBar").html("Uploading...  0%  ");
  uploadFileAjax("/upload_media", theFile, filename,
    function(progress) { $stat.html("Uploading...  "+progress+"  "); },
    function(response) {
      var data = JSON.parse(response);
      $stat.html(""); 
      if (data.success) {
        $("#in").val($("#in").val() + " https://teamwiki.de:8443/" + data.fileSpec);
      } else {
        alert("Upload failed!");
      }
    }
  );
}
window.uploadFileAjax=function(url,f,filename,onProgress,onDone) {
  var reader = new FileReader();
  reader.onload=(function(theFile) {
    return function(e) {
      var xmlHttpRequest = new XMLHttpRequest();
      xmlHttpRequest.open("POST", url, true);
      var dashes = '--', boundary = 'chatAttachmentUploader', crlf = "\r\n";
      
      //Post with the correct MIME type (If the OS can identify one)
      var filetype = theFile.type == '' ? 'application/octet-stream' : theFile.type;
      
      //Build a HTTP request to post the file
      var data = dashes + boundary + crlf + "Content-Disposition: form-data;" + "name=\"media\";" + "filename=\"" + unescape(encodeURIComponent(filename)) + "\"" + crlf + "Content-Type: " + filetype + crlf + crlf + e.target.result + crlf + dashes + boundary + dashes;
      
      xmlHttpRequest.upload.addEventListener("progress", function(e){ if (e.lengthComputable) {
          onProgress(parseInt((e.loaded / e.total) * 100)+"%"); } }, false);
      
      xmlHttpRequest.addEventListener("readystatechange", function (event) {
        if (xmlHttpRequest.readyState == 4) {  onDone(xmlHttpRequest.responseText)  } }, false);
      
      xmlHttpRequest.setRequestHeader("Content-Type", "multipart/form-data;boundary=" + boundary);
      xmlHttpRequest.sendAsBinary(data); //Send the binary data
    };
  })(f);
  reader.readAsBinaryString(f);
}