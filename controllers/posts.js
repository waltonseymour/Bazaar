var models = require('../models');
var _ = require('underscore');
var async = require('async');
var util = require('../utilities');
var uuid = require('node-uuid');

var publicOptions = {attributes: ['id', 'title', 'description', 'createdAt', 'updatedAt', 'price', 'latitude', 'longitude']};
var userOptions = {attributes: ['id', 'email']};
var categoryOptions = {attributes: ['id', 'name']};

models.Post.belongsTo(models.User, {as: 'user', foreignKey: {name: 'user_id', allowNull: false}, onDelete: 'cascade'});
models.Post.belongsTo(models.Category, {as: 'category', foreignKey: {name: 'category_id', allowNull: false}, onDelete: 'cascade'});
models.Post.hasMany(models.Photo, {as: 'photos', foreignKey: 'post_id', onDelete: 'cascade'});

module.exports = {

  // lists all posts
  listAll: function(req, res, callback) {
    if (req.session.userID === undefined) { return res.send(403); }

    // defaults ordering by date
    var order = _.contains(['createdAt', 'price'], req.param('order')) ? req.param('order') : 'createdAt';
    var category = req.param('category');
    var page = req.param('page');
    var postsPerPage = req.param('postsPerPage') || 5;

    var options = {limit: postsPerPage, order: [[order, 'DESC']], include: [
      {model: models.User, as: 'user', attributes: userOptions.attributes},
      {model: models.Photo, as: 'photos'},
      {model: models.Category, as: 'category', attributes: categoryOptions.attributes}]};

    if (util.isUUID(category)){
      options = _.extend(options, {where: {category_id: category}});
    }
    // page number starts at 1
    if (page && !isNaN(page) && page > 1){
      options = _.extend(options, {offset: (page - 1) * postsPerPage});
    }

    models.Post.findAll(options).success(function (posts) {
      if (callback) {
        callback(posts);
      }
      else {
        res.send(posts);
      }
    });
  },

  // get post by id
  getByID: function(req, res){
    if (req.session.userID === undefined) { return res.send(403); }
    if (!util.isUUID(req.params.id)) { return res.send(401); }

    var options = _.extend({}, publicOptions, {where: {id: req.params.id}, include: [
      {model: models.User, as: 'user', attributes: userOptions.attributes},
      {model: models.Photo, as: 'photos'},
      {model: models.Category, as: 'category', attributes: categoryOptions.attributes}]});
    models.Post.find(options).success(function(post){
      if(post){
        res.send(post);
      }
      else{
        res.status(404).end();
      }
    });
  },

  // modifies by id
  putByID: function(req, res) {
    models.Post.find({where: {id: req.params.id}}).then(function (post) {
      if (!post) { return res.status(404).end(); }
      if (req.session.userID !== post.user_id) { return res.status(403).end(); }
      var newPost = req.body;
      // ensures all fields are set
      if (newPost.title && newPost.description && newPost.price && newPost.category_id &&
      util.isUUID(newPost.category_id)){
        post.title = newPost.title;
        post.description = newPost.description;
        post.price = newPost.price;

        // ensures category_id is a valid foreign key if they differ
        if (post.category_id !== newPost.category_id) {
          models.Category.find({where: {id: newPost.category_id}}).then(function (category) {
            if (category){
              post.category_id = newPost.category_id;
              post.save().then(function () {
                res.send(post);
              });
            }
            else{
              res.status(401).end();
            }
          });
        }
        // else if category_id's are the same, save changes and return
        else{
          post.save().then(function () {
            res.send(post);
          });
        }
      }
      else{
        res.status(401).end();
      }
    });
  },

  // deletes by id
  deleteByID: function(req, res) {
    if (!util.isUUID(req.params.id)) { return res.send(401); }
    var options = {where: {id: req.params.id}};
    // verifies user owns post
    models.Post.find(options).then(function (ret) {
      return ret.user_id === req.session.userID;
    }).then(function (valid) {
      // sends 403 if user does not own post
      if (!valid) { return res.send(403); }
      // otherwise deletes photos and post
      // will delete all photos in database with ondelete cascade
      models.Photo.findAll({where: {post_id: req.params.id}})
      .then(function (photos) {
        var photoIDs = _.map(photos, function(photo){ return photo.id; });
        if (photoIDs) { util.deletePhotos(photoIDs); }
      })
      .then(function () { models.Post.destroy(options); })
      .then(function (ret) {
        res.status(204).end();
      });
    });
  },

  create: function(req, res) {
    if (req.session.userID === undefined) { return res.send(403); }
    var post = req.body;
    models.Post.find({where: {id: post.id}}).then(function (ret) {
      // returns true if post with id exists
      return !!ret;
    }).then(function (post_exists) {
      if (post_exists){
        // sends 401 if user exists
        return res.send(401);
      }
      else {
        // creates user otherwise
        CreatePost(req, res, post);
      }
    });
  },

  // inserts row into database and returns presigned url for uploading
  upload: function(req, res) {
    if (req.session.userID === undefined) { return res.send(403); }
    if (!util.isUUID(req.params.id) || !req.body.contentType) { return res.send(401); }
    var photoID = req.body.id || uuid.v4();
    var postID = req.params.id;
    var photo = { id: photoID, post_id: postID };
    models.Post.find({where: {id: postID}})
    .then(function (post) {
      return post && post.user_id === req.session.userID;
    })
    .then(function (valid){
      if (valid) {
        models.Photo.create(photo)
        .then(function (ret) {
          var contentType = req.body.contentType;
          var options = {key: 'bazaar/' + photoID, method: 'put', contentType: contentType};
          util.sign_s3(options, function (data) {
            res.send(data);
          });
        });
      }
      else {
        return res.status(403).end();
      }
    });
  },

  // returns a list of presigned urls associated with a post
  getPhotos: function(req, res) {
    if (req.session.userID === undefined) { return res.send(403); }
    var postID = req.params.id;
    models.Photo.findAll({where: {post_id: postID}}).then(function (photos) {
      async.map(photos, function(photo, callback) {
        var options = {key: 'bazaar/' + photo.id, method: 'get'};
        util.sign_s3(options, function(signed_url) {
          callback(null, signed_url);
        });
      }, function(err, result){
        res.send(result);
      });

    });
  },

  // returns a list of presigned urls associated with a post
  getPhotoByID: function(req, res) {
    if (req.session.userID === undefined) { return res.send(403); }
    var postID = req.params.id;
    var photoID = req.params.photoID;
    models.Photo.find({where: {id: photoID}}).then(function (photo) {
      util.sign_s3({method: 'get', key: 'bazaar/' + photo.id}, function(url){
        res.redirect(301, url);
      });
    });
  }

};

// Creates post with sepecified fields
function CreatePost (req, res, post) {
  if (post.title && post.description && post.category_id && post.price &&
    !isNaN(post.price) && post.latitude && post.longitude) {

    post.user_id = req.session.userID;
    models.Post.create(post).then(function () {
      res.status(204).end();
    });
  }
  else {
    res.status(401).end();
  }
}
