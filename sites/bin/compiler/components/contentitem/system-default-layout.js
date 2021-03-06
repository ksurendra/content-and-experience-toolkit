/**
 * Confidential and Proprietary for Oracle Corporation
 *
 * This computer program contains valuable, confidential, and
 * proprietary information. Disclosure, use, or reproduction
 * without the written authorization of Oracle is prohibited.
 * This unpublished work by Oracle is protected by the laws
 * of the United States and other countries. If publication
 * of this computer program should occur, the following notice
 * shall apply:
 *
 * Copyright (c) 2014 Oracle Corp.
 * All rights reserved.
 *
 * $Id: system-default-layout.js 167153 2019-01-25 21:29:15Z muralik $
 */
var fs = require('fs'),
	path = require('path'),
	mustache = require('mustache'),
	marked = require('marked');


var isDigitalAsset = function (id) {
	return /^DigitalAsset_/i.test(id) || (id.length === 36 && (/^CONT/.test(id) || /^CORE/.test(id)));
};

var isRichText = function (content) {
	return typeof content === 'string' && content.toLowerCase().indexOf('<!doctype html>') === 0;
};

var isMarkdownText = function (content) {
	return typeof content === 'string' && content.toLowerCase().indexOf('<!---mde-->') === 0;
};

var getRichText = function (content) {
	var newVal = content.replace(/<!doctype html>/i, '').
	replace(/<script/gi, '&#60;script').
	replace(/<\/script>/gi, '&#60;&#47;script&#62;').
	replace(/<embed/gi, '&#60;embed').
	replace(/<\/embed>/gi, '&#60;&#47;embed&#62;').
	replace(/<form/gi, '&#60;form').
	replace(/<\/form>/gi, '&#60;&#47;form&#62;').
	replace(/<object/gi, '&#60;object').
	replace(/<\/object>/gi, '&#60;&#47;object&#62;').
	replace(/<applet/gi, '&#60;applet').
	replace(/<\/applet>/gi, '&#60;&#47;applet&#62;').
	replace(/javascript:/gi, 'java-script:').
	replace(/vbscript:/gi, 'vb-script:');

	return newVal;
};

var getMarkdownText = function (content) {
	var newVal = content.replace(/<!---mde-->/i, '');

	newVal = marked(newVal);

	return newVal;
};

var ContentLayout = function (params) {
	this.contentItemData = params.contentItemData || {};
	this.scsData = params.scsData;
	this.contentClient = params.contentClient || params.scsData.contentClient;
};

ContentLayout.prototype = {

	contentVersion: '>=1.0.0',
	compile: function () {
		var self = this,
			content = JSON.parse(JSON.stringify(self.contentItemData)); // copy the data as we want to update it

		// check if we need to get more information on referenced digitalAssets
		var digitalAssetIds = [],
			fieldEntries = [];

		// only support this for v1.1 data and above
		if (self.contentClient && self.contentClient.getInfo().contentVersion !== 'v1.0') {
			// get all the referenced digital assets without mime-types
			if (content.fields) {
				Object.keys(content.fields).forEach(function (key) {
					var fieldValue = content.fields[key];
					if (fieldValue && (typeof fieldValue === 'object') && (fieldValue.type === 'DigitalAsset') && !(fieldValue.fields && fieldValue.fields.mimeType) && fieldValue.id) {
						// it's a digitial asset without a mimeType, add to the list of assets to fetch
						digitalAssetIds.push(fieldValue.id);

						// save the field entry in content to update the value with the mime-type
						fieldEntries.push(fieldValue);
					}
				});
			}

			// fetch digital assets with missing mime-types
			if (digitalAssetIds.length > 0) {
				return self.contentClient.getItems({
					'ids': digitalAssetIds
				}).then(function (digitalAssets) {
					// handle both array or object being returned
					var mimeTypes = Array.isArray(digitalAssets.items) ? digitalAssets.items.reduce(function (obj, item) {
						obj[item.id] = item;
						return obj;
					}, {}) : digitalAssets.items;

					// update the fields proeprty in the existing data
					fieldEntries.forEach(function (entry) {
						if (mimeTypes[entry.id]) {
							entry.fields = mimeTypes[entry.id].fields;
							if (!entry.name) {
								entry.name = mimeTypes[entry.id].name;
							}
						}
					});

					// render with updated content data
					return self.compileWithData(content);
				}).catch(function () {
					// failed to get referenced digital assets, render without them
					return self.compileWithData(content);
				});
			} else {
				// no referenced digital assets without mime-type, continue as before
				return self.compileWithData(content);
			}
		} else {
			// no content client passed, can't re-query so continue as before
			return self.compilerWithData(content);
		}
	},
	compileWithData: function (content) {
		var contentClient = this.contentClient,
			contentType = 'published',
			secureContent = false;

		if (this.scsData) {
			content.scsData = this.scsData;
			contentType = content.scsData.showPublishedContent === true ? 'published' : 'draft';
			secureContent = content.scsData.secureContent;
		}

		var contentVersion = contentClient.getInfo().contentVersion;

		content.render = {};
		content.render.items = [];
		var params,
			renditionURL;

		function addItem(p) {
			if (isMarkdownText(p)) {
				content.render.items.push({
					'markdownText': getMarkdownText(contentClient.expandMacros(p))
				});
			} else if (isRichText(p)) {
				content.render.items.push({
					'richText': contentClient.expandMacros(getRichText(p))
				});
			} else if (typeof p === 'string' && isDigitalAsset(p)) {
				params = {
					'itemGUID': p,
					'contentType': contentType,
					'secureContent': secureContent
				};
				renditionURL = contentClient.getRenditionURL(params);
				content.render.items.push({
					'image': renditionURL
				});
			} else if (typeof p === 'object' && p !== null) {
				if (p.type === 'DigitalAsset' && p.id) {
					params = {
						'itemGUID': p.id,
						'contentType': contentType,
						'secureContent': secureContent
					};
					renditionURL = contentClient.getRenditionURL(params);
					if (!(p.fields && p.fields.mimeType) || (p.fields && p.fields.mimeType.indexOf('image/') === 0)) {
						// render as image
						content.render.items.push({
							image: renditionURL
						});
					} else {
						var daName = p.name || content.name,
							displayName = daName.split('.').slice(0, -1).join('.') || daName,
							daSuffix = daName.replace(displayName, '').replace('.', ''),
							displayType = daSuffix ? '(' + daSuffix + ')' : '';

						// render as download
						content.render.items.push({
							download: {
								url: renditionURL,
								name: daName,
								displayName: displayName,
								displayType: displayType
							}
						});
					}
				} else if (p.timezone && p.value) {
					var dvalue = new Date(p.value);

					// check valid date
					if (Object.prototype.toString.call(dvalue) === '[object Date]' && !isNaN(dvalue.getTime())) {
						content.render.items.push({
							'text': dvalue.toLocaleString()
						});
					}
				}
			} else if (typeof p === 'string' || typeof p === 'number' || typeof p === 'boolean') {
				content.render.items.push({
					'text': p
				});
			}
		}

		var fieldName = contentVersion === 'v1' ? 'data' : 'fields';
		for (var property in content[fieldName]) {
			if (content[fieldName].hasOwnProperty(property)) {
				var p = content[fieldName][property];

				if (Array.isArray(p)) {
					for (var i in p) {
						addItem(p[i]);
					}
				} else {
					addItem(p);
				}
			}
		}

		// handle no items
		if (content.render.items.length === 0) {
			content.render.items.push({
				'text': content.name
			});
		}

		var compiledContent = '';
		try {
			// load up the template
			var templateHtml = fs.readFileSync(path.join(__dirname, 'system-default-layout.html'), 'utf8');

			// apply mustache
			compiledContent = mustache.render(templateHtml, content);
		} catch (e) {
			console.error(e.stack);
		}

		return Promise.resolve({
			content: compiledContent
		});
	}
};

module.exports = ContentLayout;