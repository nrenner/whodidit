// WHODIDID Frontend JS. Written by Ilya Zverev, licensed WTFPL

var map;
var popup;
var vectorLayer;
var permalink;

var changeset;
var username;
var age;
var defaultage = 7; // should be equal to the default age in tiles.php

var cookieName = '_wdi_location'; // comment out to not remember last location
var epsg4326 =  new OpenLayers.Projection("EPSG:4326"); //WGS 1984 projection

function init() {
    var queryString = parseQueryString();

    if( queryString.changeset ) setChangeset(queryString.changeset);
    if( queryString.user ) setUser(queryString.user);
    setAge(queryString.age ? queryString.age : defaultage);

    map = new OpenLayers.Map('map', {displayProjection: epsg4326});

    map.addLayer(new OpenLayers.Layer.OSM()); //Standard mapnik tiles

    permalink = new OpenLayers.Control.Permalink('permalink', null, {createParams: myCreateArgs});
    map.addControls([
        permalink,
        new OpenLayers.Control.MousePosition({numDigits: 3})
    ]);

    projectTo = map.getProjectionObject(); //The map projection (Spherical Mercator)

    // boxLayer is used to draw rectangles, which are bounds for a RSS feed.
    boxLayer = new OpenLayers.Layer.Vector('BBOX');
    map.addLayer(boxLayer);
    boxControl = new OpenLayers.Control.DrawFeature(boxLayer, OpenLayers.Handler.RegularPolygon, {featureAdded: featureAdded, handlerOptions: {
        sides: 4,
        irregular: true
    }});

    map.addControl(boxControl);

    // Styling for tile layer
    var context = {
        getColor: function(feature) {
            if( feature.attributes.nodes_deleted > 0 && feature.attributes.nodes_modified + feature.attributes.nodes_created == 0 ) return 'red';
            if( feature.attributes.nodes_deleted > 0 && (+feature.attributes.nodes_modified) + (+feature.attributes.nodes_created) < feature.attributes.nodes_deleted * 40 ) return 'yellow';
            if( (+feature.attributes.nodes_modified) > 40 ) return 'yellow';
            return '#7f7';
        }
    };
    var template = {
        fillColor: "${getColor}",
        fillOpacity: 0.4,
        strokeColor: '#333',
        strokeOpacity: 0.4
    };
    var style = new OpenLayers.Style(template, {context: context});

    vectorLayer = new OpenLayers.Layer.Vector("WhoDidIt Tiles", {
        strategies: [new OpenLayers.Strategy.BBOX({resFactor: 2.0, ratio: 1.3})],
        protocol: new OpenLayers.Protocol.HTTP({
            url: scripts + 'tiles.php',
            params: getParams(),
            format: new OpenLayers.Format.GeoJSON()
        }),
        styleMap: new OpenLayers.StyleMap({'default': style, 'select': OpenLayers.Feature.Vector.style["select"]}),
        projection: epsg4326
    });

    map.addLayer(vectorLayer);

    // Set centre. The location of the last lat lon to be processed. 
    restoreLocation();
    if (!map.getCenter()) {
        var zoom=4;
        var lonLat = new OpenLayers.LonLat(32, 50).transform(epsg4326, projectTo);
        map.setCenter (lonLat, zoom);
    }

    // Add a selector control to the vectorLayer with popup functions
    var selector = new OpenLayers.Control.SelectFeature(vectorLayer, { onSelect: createPopup, onUnselect: destroyPopup });

    function createPopup(feature) {
        var nodeinfo = feature.attributes.nodes_created + ' nodes created, ' + feature.attributes.nodes_modified + ' modified, ' + feature.attributes.nodes_deleted + ' deleted in this tile.<br>';
        popup = new OpenLayers.Popup.FramedCloud("pop",
            feature.geometry.getBounds().getCenterLonLat(),
            null,
            '<div class="markerContent">' + nodeinfo + 'Changesets: ' + feature.attributes.changesets + '</div>',
            null,
            true,
            function() { selector.unselectAll(); }
        );
        // Send ajax request to get changeset information
        var request = OpenLayers.Request.GET({
            url: scripts + 'changeset.php',
            params: { id: feature.attributes.changesets },
            callback: function(req) {
                var json = new OpenLayers.Format.JSON();
                var changesets = json.read(req.responseText);
                var html = '<div class="markerContent">' + nodeinfo + '<br>';
                var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                for( i = 0; i < changesets.length; i++ ) {
                    var ch = changesets[i];
                    html += '<div class="changeset" style="white-space: nowrap;">';
                    var color = ch['suspicious'] ? 'red' : 'green';
                    var date_str = months[ch['change_time'].substr(5,2)-1] + ' ' + ch['change_time'].substr(8,2);
                    html += '<span style="color: '+color+';">' + date_str + '</span>';
                    html += ': <a href="http://openstreetmap.org/browse/changeset/' + ch['changeset_id'] + '">changeset</a>';
                    html += ' <a href="#" title="Filter by this changeset" onclick="setChangeset(' + ch['changeset_id'] + '); return false;" class="filter">[F]</a>';
                    html += ' by user <a href="http://openstreetmap.org/user/' + encodeURI(ch['user_name']) + '">' + htmlEscape(ch['user_name']) + '</a>';
                    html += ' <a href="#" title="Filter by this user" onclick="setUser(\'' + htmlEscape(ch['user_name']) + '\'); return false;" class="filter">[F]</a>';
                    html += '. <span class="stat">Nodes:<span class="graph"><span class="created">'+ch['nodes_created']+'</span><span class="modified">'+ch['nodes_modified']+'</span><span class="deleted">'+ch['nodes_deleted']+'</span></span></span>';
                    html += ' <span class="stat">Ways:<span class="graph"><span class="created">'+ch['ways_created']+'</span><span class="modified">'+ch['ways_modified']+'</span><span class="deleted">'+ch['ways_deleted']+'</span></span></span>';
                    html += ' <span class="stat">Rels:<span class="graph"><span class="created">'+ch['relations_created']+'</span><span class="modified">'+ch['relations_modified']+'</span><span class="deleted">'+ch['relations_deleted']+'</span></span></span>';
                    if( ch['comment'] && ch['comment'].length > 2 && ch['comment'].substring(0,5) != 'BBOX:' )
                        html += '<div class="comment">' + htmlEscape(ch['comment']) + '</div>';
                    html += '</div>';
                }
                html += '</div>';
                feature.popup.setContentHTML(html);
            }
        });
        feature.popup = popup;
        popup.feature = feature;
        map.addPopup(popup);
    }

    function destroyPopup(feature) {
        if( feature.popup) {
            map.removePopup(feature.popup);
            popup.feature = null;
            feature.popup.destroy();
            feature.popup = null;
            popup = null;
        }
    }

    // When map is dragged, all features are redrawn, but popup stays and becomes unclosable. This fixes it.
    vectorLayer.events.register('beforefeaturesremoved', ' ', function() { if(popup) destroyPopup(popup.feature); });

    selector.handlers.feature.stopDown = false;
    map.addControl(selector);
    selector.activate();

    // Get latest changeset date
    OpenLayers.Request.GET({
        url: scripts + 'changeset.php',
        params: { latest: 1 },
        callback: function(req) {
            var json = new OpenLayers.Format.JSON();
            var changesets = json.read(req.responseText);
            if( changesets.length > 0 ) {
                document.getElementById('whodidit').title = 'Last changeset from ' + changesets[0]['change_time'] + ' UTC';
            }
        }
    });

    // Add &show=1 to zoom on user/changeset tiles
    if( queryString.show ) {
        zoomToTiles();
    }

    // Remember last shown location in cookies
    map.events.register("moveend", map, saveLocation);
    saveLocation();
}

/* --------------------------  END OF INIT()  ------------------------------------------- */

function parseQueryString() {
    var query_string = {};
    var query = window.location.search.substring(1);
    var vars = query.split("&");
    for( var i = 0; i < vars.length; i++ ) {
        var pair = vars[i].split("=");
        if (typeof query_string[pair[0]] === "undefined") {
            // If first entry with this name
            query_string[pair[0]] = pair[1];
        } else if (typeof query_string[pair[0]] === "string") {
            // If second entry with this name
            var arr = [ query_string[pair[0]], pair[1] ];
            query_string[pair[0]] = arr;
        } else {
            // If third or later entry with this name
            query_string[pair[0]].push(pair[1]);
        }
    } 
    return query_string;
}
    
// Fiddle with permalink's url parameters
function myCreateArgs() {
    var args = OpenLayers.Control.Permalink.prototype.createParams.apply(this, arguments);
    if( changeset ) args['changeset'] = changeset; else delete args['changeset'];
    if( username ) args['user'] = username; else delete args['user'];
    if( age != defaultage ) args['age'] = age; else delete args['age'];
    delete args['show'];
    return args;
}

function htmlEscape(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// This is used in tiles ajax request
function getParams() {
    return {
        'age': age,
        'changeset': changeset,
        'user': username
    };
}

function setChangeset(ch) {
    clearFilter();
    if( ch ) {
        document.getElementById('vuser').style.visibility = 'hidden';
        document.getElementById('tchangeset').value = ch;
        document.getElementById('bchangeset').value = 'Clear';
        document.getElementById('tchangeset').disabled = true;
        changeset = ch;
        username = '';
        document.getElementById('vwhere').style.visibility = 'inherit';
    }
    updateParams();
}

function setUser(ch) {
    clearFilter();
    if( ch ) {
        document.getElementById('vchangeset').style.visibility = 'hidden';
        document.getElementById('tuser').value = ch;
        document.getElementById('buser').value = 'Clear';
        document.getElementById('tuser').disabled = true;
        changeset = '';
        username = ch;
        document.getElementById('vwhere').style.visibility = 'inherit';
    }
    updateParams();
}

function setAge(ch) {
    age = ch;
    var sel = document.getElementById('tage');
    var s;
    for( i = sel.options.length-1; i >= 0; i-- ) {
        if( sel.options[i].value - age >= 0 )
            s = i;
    }
    sel.selectedIndex = s;
    updateParams();
}

function apply(what) {
    if( changeset || username ) {
        clearFilter();
    } else if( what == 'changeset' ) {
        setChangeset(document.getElementById('tchangeset').value);
    } else if( what == 'user' ) {
        setUser(document.getElementById('tuser').value);
    }
}

function clearFilter() {
    document.getElementById('tchangeset').disabled = false;
    document.getElementById('tchangeset').value = '';
    document.getElementById('bchangeset').value = 'Apply';
    document.getElementById('vchangeset').style.visibility = 'inherit';
    changeset = '';
    document.getElementById('tuser').disabled = false;
    document.getElementById('tuser').value = '';
    document.getElementById('buser').value = 'Apply';
    document.getElementById('vuser').style.visibility = 'inherit';
    username = '';
    document.getElementById('vwhere').style.visibility = 'hidden';
    updateParams();
}

function updateParams() {
    if( vectorLayer ) {
        vectorLayer.protocol.options.params = getParams();
        vectorLayer.refresh({
            force: true,
            params: getParams()
        });
        permalink.updateLink();
    }
}

// Callback methods for drawing box for a RSS feed
function startDrawBBOX() {
    if( boxLayer.features.length > 0 ) {
        boxLayer.removeAllFeatures();
        document.getElementById('brss').value='Get RSS link';
        document.getElementById('rssurl').style.visibility='hidden';
    } else {
        boxControl.activate();
        document.getElementById('brss').value='Draw a box';
    }
}

function featureAdded(feature) {
    boxControl.deactivate();
    document.getElementById('brss').value='Clear RSS link';
    document.getElementById('rssurl').style.visibility='inherit';
    document.getElementById('rssurl').href=scripts + 'rss.php?bbox=' + feature.geometry.bounds.transform(projectTo, epsg4326).toBBOX();
}

function zoomToTiles() {
    // zooming to tiles obviously calls for ajax request
    var request = OpenLayers.Request.GET({
        url: scripts + 'tiles.php?extent=1',
        params: getParams(),
        callback: function(req) {
            var json = new OpenLayers.Format.JSON();
            var bbox = json.read(req.responseText);
            if( bbox.length == 4 ) {
                var bounds = new OpenLayers.Bounds(bbox[0], bbox[1], bbox[2], bbox[3]);
                map.zoomToExtent(bounds.transform(epsg4326, projectTo));
            }
        }
    });
}

function saveLocation() {
    if( !cookieName ) return;
    var lonlat = map.getCenter().transform(map.getProjectionObject(), epsg4326);
    var zoom = map.getZoom();
    var expiry = new Date();
    expiry.setYear(expiry.getFullYear() + 10);
    document.cookie = cookieName + '=' + [lonlat.lon, lonlat.lat, zoom].join("|") + ';expires=' + expiry.toGMTString();
}

function restoreLocation() {
    if( !cookieName ) return;
    if( document.cookie.length > 0 ) {
        var start = document.cookie.indexOf(cookieName + '=');
        if( start >= 0 ) {
            start += cookieName.length + 1;
            var end = document.cookie.indexOf(';', start);
            if( end < 0 ) end = document.cookie.length;
            var location = document.cookie.substring(start, end).split('|');
            if( location.length == 3 ) {
                var lon = parseFloat(location[0]);
                var lat = parseFloat(location[1]);
                var zoom = parseFloat(location[2]);
                map.setCenter(new OpenLayers.LonLat(lon, lat).transform(epsg4326, map.getProjectionObject()), zoom);
            }
        }
    }
}