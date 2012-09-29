<? # Returns all tiles inside a bbox, possibly filtered. Written by Ilya Zverev, licensed WTFPL.
header('Content-type: application/json; charset=utf-8');
require("db.inc.php");
$extent = isset($_REQUEST['extent']) && $_REQUEST['extent'] = '1';
$bbox = parse_bbox(isset($_REQUEST['bbox']) ? $_REQUEST['bbox'] : '');
if( !$bbox && !$extent ) {
    print '{ "error" : "BBox required." }';
    exit;
} else {
    #file_put_contents('debug', "$bbox[0] $bbox[1] $bbox[2] $bbox[3]: ".(($bbox[2]-$bbox[0]) * ($bbox[3]-$bbox[1])));
    if( ($bbox[2]-$bbox[0]) * ($bbox[3]-$bbox[1]) > 6000 ) {
        print '{ "error" : "Too big bbox" }';
        exit;
    }
}

$db = connect();
$changeset = isset($_REQUEST['changeset']) && preg_match('/^\d+$/', $_REQUEST['changeset']) ? ' and t.changeset_id = '.$_REQUEST['changeset'] : '';
$user = isset($_REQUEST['user']) && strlen($_REQUEST['user']) > 0 ? ' and c.user_name = \''.$db->escape_string($_REQUEST['user']).'\'' : '';
$age = isset($_REQUEST['age']) && preg_match('/^\d+$/', $_REQUEST['age']) ? $_REQUEST['age'] : 7;
$age_sql = $changeset ? '' : " and date_add(c.change_time, interval $age day) > now()";
$bbox_query = $extent ? '' : " and t.lon >= $bbox[0] and t.lon <= $bbox[2] and t.lat >= $bbox[1] and t.lat <= $bbox[3]";

if( $extent ) {
    // write bbox and exit
    $sql = 'select min(t.lon), min(t.lat), max(t.lon), max(t.lat) from wdi_tiles t, wdi_changesets c where c.changeset_id = t.changeset_id'.$age_sql.$user.$changeset;
    $res = $db->query($sql);
    if( $res === FALSE || $res->num_rows == 0 ) {
        print '{ "error" : "Cannot determine bounds" }';
        exit;
    }
    $row = $res->fetch_array();
    print '[';
    if( !$row[0] && !$row[3] ) {
        print '"no results"';
    } else {
        for( $i = 0; $i < 4; $i++ ) {
            print ($row[$i] + ($i < 2 ? 0 : 1)) * $tile_size;
            if( $i < 3 ) print ', ';
        }
    }
    print ']';
    exit;
}

$sql = 'select t.lat, t.lon, left(group_concat(t.changeset_id order by t.changeset_id desc separator \',\'),300) as changesets, sum(t.nodes_created) as nc, sum(t.nodes_modified) as nm, sum(t.nodes_deleted) as nd from wdi_tiles t, wdi_changesets c where c.changeset_id = t.changeset_id'.
    $bbox_query.
    $age_sql.
    $user.
    $changeset.
    ' group by t.lat,t.lon limit 1001';

$res = $db->query($sql);
if( $res->num_rows > 1000 ) {
    print '{ "error" : "Too many rows." }';
    exit;
}

print '{ "type" : "FeatureCollection", "features" : ['."\n";
$first = true;
$id = 0;
while( $row = $res->fetch_assoc() ) {
    if( !$first ) print ",\n"; else $first = false;
    $lon = $row['lon'] * $tile_size;
    $lat = $row['lat'] * $tile_size;
    $poly = array( array($lon, $lat), array($lon+$tile_size, $lat), array($lon+$tile_size, $lat+$tile_size), array($lon, $lat+$tile_size), array($lon, $lat) );
    $changesets = $row['changesets'];
    if( substr_count($changesets, ',') >= 10 ) {
        $changesets = implode(',', array_slice(explode(',', $changesets), 0, 10));
    }
    $feature = array(
        'type' => 'Feature',
        'geometry' => array(
            'type' => 'Polygon',
            'coordinates' => array($poly)
        ),
        'properties' => array(
            'changesets' => $changesets,
            'nodes_created' => $row['nc'],
            'nodes_modified' => $row['nm'],
            'nodes_deleted' => $row['nd']
        )
        #'id' => 'a'.($id++)
    );
    print json_encode($feature);
}
print "\n] }";
?>