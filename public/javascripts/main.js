(function() {
  "use strict";

  var moment = require('moment');
  var _ = require('underscore');
  var uuid = require('node-uuid');
  var numeral = require('numeral');
  var MobileDetect = require('mobile-detect');
  var md = new MobileDetect(window.navigator.userAgent);

  // Stores JSON data for posts
  var POST_CACHE = {};

  // global variables
  var globals = {};

  function initializeMap() {
    var options = getCurrentOptions();

    var mapOptions = {
      // hardcodes to nashville for now
      center: { lat: options.latitude, lng: options.longitude},
      zoom: 11,
      disableDefaultUI: true,
      zoomControl: true,
      draggable: !md.mobile()
    };
    globals.map = new google.maps.Map(document.getElementById('map-canvas'), mapOptions);

    google.maps.event.addListener(globals.map, 'idle', function() {
      getPosts();
    });
  }

  // initializes markers on the map
  function addMarkers(posts){
    globals.markers = {};
    _.each(posts, function(post){
      var marker = new google.maps.Marker({
        position: { lat: post.latitude, lng: post.longitude},
        map: globals.map,
        animation: google.maps.Animation.DROP
      });
      marker.postID = post.id;
      google.maps.event.addListener(marker, 'mouseover', function(marker) {
        var $post = $("div").find("[data-id='" + this.postID + "']");
        $post.addClass('hover');
      });
      google.maps.event.addListener(marker, 'click', function(marker) {
        getPost(this.postID);
      });
      google.maps.event.addListener(marker, 'mouseout', function(marker) {
        var $post = $("div").find("[data-id='" + this.postID + "']");
        $post.removeClass('hover');
      });
      // indexes markers by postID
      globals.markers[marker.postID] = marker;
    });
  }

  function preload(){
    var urls = [];
    _.each(globals.posts, function(post){
      var photo = post.photos[0];
      if (photo) {
        urls.push('/posts/' + post.id + '/photos/' + photo.id);
      }
    });
    $(urls).each(function(){
      $('<img/>')[0].src = this;
    });
  }

  // initialization
  initializeMap();
  if (md.mobile()) {
    $('#panels > div').each(function() {
      $(this).prependTo(this.parentNode);
    });
  }

  function getCurrentOptions(overrides){
    overrides = overrides || {};
    var options = _.defaults(overrides, {
      page: parseInt($('#post-container').attr('data-page')) || 1,
      category: $('#category-filter').val(),
      order: $('input[type=radio][name=order]:checked').val(),
      latitude: globals.latitude || 36.1658897400,
      longitude: globals.longitude || -86.7844467163,
      radius: globals.radius || 50,
      postsPerPage: 100
    });
    return options;
  }

  $(document).keydown(function(e) {
    if($("input").is(":focus") || $(".modal-backdrop").length > 0){ return; }
    switch(e.which) {
      case 37: changePage(false);
      break;
      case 39: changePage(true);
      break;
      default: return; // exit this handler for other keys
    }
    e.preventDefault(); // prevent the default action (scroll / move caret)
  });

  $('#post-container nav .pager .next, #post-container nav .pager .previous').click(function(event){
    changePage($(event.target).parent().hasClass('next'));
    return false;
  });

  $(".btn-group .btn").on("click", function(){
     $(".btn-group").find(".active").removeClass("active");
     $(this).parent().addClass("active");
  });

  $('body').on('click', '.post', function (event) {
    getPost($(this).attr('data-id'));
  });

  $('body').on('click', '.post .category-tag', function (event) {
    $('#category-filter').val($(this).attr('value')).change();
    event.stopPropagation();
  });

  $('body').on('mouseover', '.modal-thumbnail', function(event){
    var url = $(this).css('background-image');
    $('.modal-image').css('background-image', url);
  });

  $('.control-panel .panel-heading .fa').click(function(){
    $('#category-filter').selectpicker('val', 'All');
    $('#search-form input').val('');
    getPosts(getCurrentOptions({page: 1, category: "All"}));
  });

  $('input[type=radio][name=order]').change(function() {
    // resets page to 1 on ordering change
    getPosts(getCurrentOptions({page: 1}));
  });

  $('body').on('click', '.modal', function (event) {
    if(typeof $(event.target).attr('id') != 'undefined'){
      $(event.target).modal('hide');
    }
  });

  $('body').on('click', '.edit', function (event) {
    $('#post-modal .post-description, #post-modal .post-title, ' +
    '#post-modal .post-price').attr('contenteditable', 'true')
    .addClass('editable');

    $("#post-modal .modal-thumbnail").addClass('editable');

    $('#post-modal .btn-file').show();
    $("#post-modal .post-price-container").show();
    $('#post-modal .edit-confirm').show();
    $('#post-modal .edit').hide();
  });

  $('body').on('click', '.edit-confirm', function (event) {
    var id = $('#post-modal').attr('data-id');
    var post = POST_CACHE[id];
    var price = $('#post-modal .post-price').text();
    post = _.defaults({
      description: $('#post-modal .post-description').text(),
      title: $('#post-modal .post-title').text()
      }, post);
    if (!isNaN(price)){
      post.price = price;
    }
    updatePost(post);
    resetModalButtons(post);
  });

  $('body').on('click', '.delete', function (event) {
    $('#post-modal').modal('hide');
    var id = $('#post-modal').attr('data-id');
    swal({
      title: "Are you sure?",
      text: "Your post cannot be recovered",
      type: "warning",
      showCancelButton: true,
      confirmButtonColor: "#DD6B55",
      confirmButtonText: "Yes, delete it!",
      cancelButtonText: "No, cancel",
      closeOnConfirm: false,
      closeOnCancel: true
    },
    function(isConfirm){
      if (isConfirm) {
        swal("Deleted!", "Your post has been deleted.", "success");
        $.ajax({
          url: 'posts/' + id,
          type: 'DELETE',
          success: function() {
            ga('send', 'event', 'Posts', 'Delete', id);
            setTimeout(function(){ location.reload(); }, 1000);
            },
          error: function(err) { console.log("delete post failed"); }
        });
      }
      else {
        $('#post-modal').modal('show');
      }
    });
  });

  $('body').on('click', '.delete-photo', function (event) {
    var $this = $(this);
    var photoID = $(this).parent().data('photoid');
    var postID = $(this).parent().data('postid');

    $.ajax({
      url: 'posts/'+postID+"/photos/"+photoID,
      type: 'DELETE',
      success: function() {
        ga('send', 'event', 'Posts', 'Delete Photo', postID);
        var globalPost = _.findWhere(globals.posts, {id: postID});
        globalPost.photos = _.without(globalPost.photos,
          _.findWhere(globalPost.photos, {id: photoID}));
        getPost(postID);
        $('.edit').trigger('click');
      },
      error: function(err) { console.log("delete photo failed"); }
    });
  });

  $('#create-modal').on('shown.bs.modal', function () {
    $('.create-title').focus();
  });

  $('#category-filter').change(function(event){
    // resets to front page on a category change
    var options = getCurrentOptions({page: 1});
    getPosts(options);
    ga('send', 'event', 'Catgeories', 'Select', $(this).val());
  });

  $('#create-form').parsley({
    successClass: 'success',
    errorClass: 'error'
  });

  $('#create-file').fileupload({
    dataType: 'json',
    add: function(e, data){
      if (data.files && data.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
          var img = '<img class="modal-thumbnail" src="'+ e.target.result +'">';
          $('#create-form .modal-thumbnails').append(img);
        };
        reader.readAsDataURL(data.files[0]);
        if(!globals.uploadFiles){
          globals.uploadFiles = [];
        }
        globals.uploadFiles.push(data.files[0]);
      }
    }
  });

  $('#edit-file').fileupload({
    dataType: 'json',
    add: function(e, data){
      if (data.files && data.files[0]) {
        var reader = new FileReader();
        var file;
        reader.onload = function(e) {
          var id = $('#post-modal').attr('data-id');
          var $img = $('<div class="modal-thumbnail editable"><i class="delete-photo fa fa-trash"></i></div>')
          .css('background-image', "url(" + e.target.result + ")");
          $('#post-modal .modal-thumbnails').append($img);
          $('#post-modal .modal-image')
          .css('background-image', "url(" + e.target.result + ")");
          $('#post-modal .modal-image-container').show();

          uploadFiles(id, file, null, function (newPhotoIDs) {
            $img.data('postid', $('#post-modal').data('id'));
            $img.data('photoid', newPhotoIDs[0]);
            var photos = _.map(newPhotoIDs, function (id) {
              return {id: id};
            });
            var globalPost = _.findWhere(globals.posts, {id: id});
            globalPost.photos.push.apply(globalPost.photos, photos);
          });
        };
        // somewhat of a hack for now
        // prevents files being uploaded multiple times
        file = [data.files[0]];
        reader.readAsDataURL(data.files[0]);
      }
    }
  });

  $('#create-form').submit(function () {
    // retrieves location on form submission
    getLocation(function(pos){
      var crd = pos.coords;
      globals.latitude = crd.latitude;
      globals.longitude = crd.longitude;

      var post = {};
      post.id =  uuid.v4();
      post.title = $('#create-form .create-title').val();
      post.description = $('#create-form .create-description').val();
      post.price = $('#create-form .create-price').val();
      post.category_id = $('#create-form select').val();

      post.latitude = globals.latitude;
      post.longitude = globals.longitude;

      if(globals.uploadFiles){
        $('#create-modal').modal('hide');
        $('#loading-modal').modal('show');
      }
      createPost(post);
      ga('send', 'event', 'Posts', 'Create', post.id);
    },
    function(error){
      console.log(error);
      swal("Oops...", "You must have location enabled to create a post", "error");
    });
    return false;
  });

  $('#search-form').submit(function () {
    var query = $('#search-form input[type=search]').val();
    if(query === ""){
      getPosts();
      return false;
    }
    $.ajax({
      url: 'posts/search/' + query,
      type: 'GET',
      success: renderPosts,
      error: function(err) { console.log("get post failed"); }
    });
    ga('send', 'event', 'Posts', 'Search', query);
    return false;
  });

  $('#travel-form').submit(function () {
    var query = $('#travel-form input[type=search]').val();
    $.ajax({
      url: 'https://maps.googleapis.com/maps/api/geocode/json?address='+query,
      type: 'GET',
      success: function(data){
        globals.latitude = data.results[0].geometry.location.lat;
        globals.longitude = data.results[0].geometry.location.lng;
        initializeMap();
        getPosts(null, true);
        $('#travel-modal').modal('hide');
        $('#travel-form input[type=search]').val('');
      },
      error: function(err) { console.log("get post failed"); }
    });
    ga('send', 'event', 'Posts', 'Travel', query);
    return false;
  });

  $('#logout').click(logout);

  $(document).ready(function(){
    resizeModal();
  });

  window.onresize = function(event) {
    resizeModal();
  };

  function resizeModal(){
    var vph = $(window).height();
    $('.modal-body').css({'max-height': (vph - 200) + 'px'});
  }

  function formatPrice(price){
    if (price > 1000){
      return numeral(price).format('$0a').toUpperCase();
    }
    else if (price > 0){
      return '$' + price;
    }
    else{
      return "Free";
    }
  }

  function changePage(isNext){
    var options = getCurrentOptions();
    var valid = !((options.page === globals.totalPages && isNext) ||
      (options.page === 1 && !isNext));
    if (valid){
      options.page = isNext ? options.page + 1 : options.page - 1;
      getPosts(options);
      ga('send', 'event', 'Page', 'Change', options.page.toString());
    }
  }

  function getPost(id) {
    $('#post-modal').attr('data-id', id);
    renderPostModal(POST_CACHE[id]);
    ga('send', 'event', 'Posts', 'Open', id);
  }

  function getPosts(options, reset){
    options = options || getCurrentOptions();
    reset = reset || false;
    // sets data in the DOM
    $('#post-container').attr('data-page', options.page);
    // Converts to url parameters
    var params = jQuery.param(options);

    if (!globals.posts || reset){
      $.ajax({
        url: 'posts?' + params,
        type: 'GET',
        success: function(posts) {
          globals.posts = posts;
          // adds markers
          addMarkers(posts);

          // populates cache with data
          _.each(posts, function(post){
            POST_CACHE[post.id] = post;
          });

          parseURL();

          // slices first five posts to render
          renderPosts(posts.slice(0, 5));
          globals.totalPages = Math.ceil(posts.length / 5);
          $('.pager .page-info').text("Page 1 of "+ globals.totalPages);
          $('.pager .next').css('visibility', 'visible');
        },
        error: function(err) { console.log("get post failed"); }
      });
    }
    else{
      var posts = _.filter(globals.posts, function(post){
        return post.category.id === options.category || options.category === "All";
      });

      posts = _.filter(posts, function(post){
        return globals.map.getBounds().contains(globals.markers[post.id].getPosition());
      });

      posts = _.sortBy(posts, options.order);
      if (options.order === 'createdAt') {
        posts = posts.reverse();
      }
      var offset = (options.page - 1) * 5;
      renderPosts(posts.slice(offset, offset + 5));
      globals.totalPages = Math.ceil(posts.length / 5);
    }

    $('.pager .next').css('visibility', 'visible');
    $('.pager .previous').css('visibility', 'visible');
    if(globals.totalPages > 0){
      $('.pager .page-info').text("Page "+ options.page +" of "+ globals.totalPages);
    }
    else{
      $('.pager .page-info').text("");
      $('.pager .previous, .pager .next').css('visibility', 'hidden');
      return;
    }

    if (options.page === 1){
      $('.pager .previous').css('visibility', 'hidden');
    }
    else if(options.page === globals.totalPages){
      $('.pager .next').css('visibility', 'hidden');
    }
  }

  function renderPostModal(data) {
    var title = data.title;
    var price = data.price;

    resetModalButtons(data);

    // Assign values in modal
    $('#post-modal .modal-title .post-title').text(title);
    $('#post-modal .modal-title .post-price').text(price);

    $('#post-modal .modal-body .post-description').text(data.description);
    $('#post-modal .category-tag').text(data.category.name);
    $('#post-modal .modal-thumbnails').html('');

    // Handle images
    if (data.photos[0]) {
      var url = '/posts/' + data.id + '/photos/' + data.photos[0].id;
      $('#post-modal .modal-image').css('background-image', "url(" + url + ")");
      $('#post-modal .post-description').css('margin-top', '20px');
      $('#post-modal .modal-image-container').show();
      // Add thumbnails
      for (var i = 0; i< data.photos.length; i++) {
        url = '/posts/' + data.id + '/photos/' + data.photos[i].id;
        var img = $('<div class="modal-thumbnail" data-postid="'+data.id+'" data-photoid="'+data.photos[i].id+'">'+
        '<i class="delete-photo fa fa-trash"></i></div>')
        .css('background-image', "url(" + url + ")");
        $('#post-modal .modal-thumbnails').append(img);
      }
    }
    else {
      $('#post-modal .modal-image-container').hide();
      $('#post-modal .post-description').css('margin-top', '0');
    }

    var href;
    if (md.mobile()) {
      href = "mailto:"+ data.user.email +"?Subject=" + data.title;
    }
    else {
      href = "https://mail.google.com/mail/?view=cm&fs=1&to="+data.user.email+"&su="+data.title;
    }
    $('#modal-contact').attr("href", href);
    $('#post-modal').modal('show');
  }

  function renderPosts (posts) {
    // no-op if current selection equals new selection
    if (_.isEqual(globals.currentPostIds, _.pluck(posts, 'id'))){
      return;
    }

    // otherwise reassigns current selection
    globals.currentPostIds = _.pluck(posts, 'id');

    // renders ejs template passing in posts and npm modules
    var renderedPosts = new EJS({url: 'templates/posts.ejs'}).render({
      posts: posts,
      numeral: numeral,
      moment: moment
    });

    // places rendered template in the DOM
    var $container  = $('#post-container .posts');
    $container.fadeOut(200, function(){
      $container.html(renderedPosts);
      $container.fadeIn(200);
      // eagerly fetches images for new posts
      preload();
    });
  }

  function resetModalButtons(data){
    if (data.user.id === $('#user-id').val()) {
      $('#post-modal .delete').show();
      $('#post-modal .edit').show();
      $('#modal-contact').hide();
    }
    else {
      $('#post-modal .btn-file').hide();
      $('#post-modal .delete').hide();
      $('#post-modal .edit').hide();
      $('#modal-contact').show();
    }

    if (data.price === 0){
      $('#post-modal .modal-title .post-price-container').hide();
    }
    else{
      $('#post-modal .modal-title .post-price-container').show();
    }

    $('#post-modal .cancel').hide();
    $('#post-modal .edit-confirm').hide();
    $('#post-modal .btn-file').hide();
    $('#post-modal .post-description, #post-modal .post-title, ' +
    '#post-modal .post-price').attr('contenteditable', 'false')
    .removeClass('editable');
    $("#post-modal .modal-thumbnail").removeClass('editable');
  }

  function parseURL(){
    var parser = document.createElement('a');
    parser.href = window.location;
    var regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    var match = parser.hash.substr(1).match(regex);
    if (match && POST_CACHE[match[0]]){
      getPost(match[0]);
    }
  }

  function createPost(post){
    $.ajax({
      url: 'posts',
      type: 'POST',
      data: post,
      success: function(){
        var $progressBar = $('#loading-modal .progress-bar span');
        uploadFiles(post.id, globals.uploadFiles, $progressBar, function(){
          setTimeout(function(){
            location.reload();
          }, 750);
        });
      },
      error: function(err) { console.log("create post failed"); }
    });
  }

  function updatePost(post){
    $.ajax({
      url: 'posts/' + post.id,
      type: 'PUT',
      data: post,
      success: function(data){
        globals.currentPostIds = null;
        var globalPost = _.findWhere(globals.posts, {id: post.id});
        globalPost.title = data.title;
        globalPost.price = data.price;
        globalPost.description = data.description;
        globalPost.updatedAt = data.updatedAt;

        getPosts();
      },
      error: function(err) { console.log("create post failed"); }
    });
  }

  function getSignedUrls(postID, files, callback) {
    if (!files) { return location.reload(); }
    var photos = _.map(files, function(file){
      return {id: uuid.v4(), contentType: file.type};
    });
    $.ajax({
      url: 'posts/' + postID + '/photos',
      type: 'POST',
      contentType: "application/json",
      data: JSON.stringify(photos),
      success: function(urls) {
        var signedURLS = [];
        for (var i = 0; i < urls.length; i++) {
          signedURLS.push(_.extend({}, photos[i], {url: urls[i]}));
        }
        callback(signedURLS, files);
      },
      error: function(err) { console.log("get signed url failed"); }
    });
  }

  function uploadFiles(postID, files, $progressBar, callback) {
    getSignedUrls(postID, files, function(signedURLS, files){
      var ajaxCalls = [];
      for (var i = 0; i < signedURLS.length; i++){
        var deferred = createDeferred(signedURLS[i], files[i], $progressBar);
        ajaxCalls.push(deferred);
      }
      $.when.apply($, ajaxCalls).then(function(){
        if (callback) {
          callback(_.pluck(signedURLS, 'id'));
        }
      });
    });
  }

  function createDeferred(photo, file, $progressBar){
    return $.ajax({
      xhr: function() {
        var xhr = new window.XMLHttpRequest();
        xhr.upload.addEventListener("progress", function(evt) {
          if (evt.lengthComputable && $progressBar) {
            var percentComplete = evt.loaded / evt.total;
            $progressBar.css('width',
            (percentComplete*100).toString() + "%");
          }
        }, false);
        return xhr;
      },
      url: photo.url,
      type: 'PUT',
      data: file,
      success: function(){},
      contentType: photo.contentType,
      processData: false,
      error: function(err) {
        console.log(err);
        console.log("upload file failed"); }
    });
  }

  function logout(){
    $.ajax({
      url: 'users/deauth',
      type: 'POST',
      success: function() { location.reload(); },
      error: function(err) { console.log("login failed"); }
    });
  }

  function getLocation(callback, error) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(callback, error);
    } else {
      // handle unsupported browser
    }
  }

}());
