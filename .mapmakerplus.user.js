// ==UserScript==
// @name         Mapmaker+
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  https://docs.google.com/document/d/1teQOaOGpb6Ec_6nY4sJqy_UYu0GpvIiplKtgk-HL2aY/edit?tab=t.0
// @author       breeeee + Humoresque (+ ai for correcting some errors :) )
// @match        https://mapmaker.deeeep.io/*
// @match        https://mapmaker.deeeep.io/map/*
// @icon         https://cdn.deeeep.io/custom/skins/27647-1-c90f65f2-4fb1-41d4-b755-b9c509568289.png
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    try {
        console.log('Full script: Top-level loaded (use strict OK)');
    } catch (e) {
        console.error('Full script: Fatal error at top:', e);
        return;
    }

    let baseNudgeAmount = 2;
    const debugMode = true;
    let keyHandler = null;
    let flipMode = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let forceIndividualMode = false;
    let forceWholeMode = false;
    let snappingEnabled = false;
    let snapThreshold = 15;
    let enableRestore = false;


    function resetRetry() {
        retryCount = 0;
    }

    let pixiLib = null;

    function getPixiLib() {
        if (pixiLib) return pixiLib;
        pixiLib = window.PIXI || (typeof PIXI !== 'undefined' ? PIXI : null);
        if (!pixiLib && window.pixiApp) {
            pixiLib = window.pixiApp.PIXI || window.pixiApp.constructor.PIXI;
        }
        if (!pixiLib) {
            console.log('getPixiLib: PIXI not found - Will retry on demand');
        } else {
            console.log('getPixiLib: PIXI loaded successfully');
        }
        return pixiLib;
    }

    console.log('Full script: Variables defined');

    let bakedChanges = {};

    function storeBakedChange(shapeId, prop, value) {
        if (!bakedChanges[shapeId]) bakedChanges[shapeId] = {};
        bakedChanges[shapeId][prop] = value;
        if (debugMode) console.log(`Bake: Tracked ${prop} for ID ${shapeId}:`, value);
    }

    function bakeIntoScreenObjects(screenObjects) {
        if (!Array.isArray(screenObjects)) return;
        let bakedCount = 0;
        screenObjects.forEach(obj => {
            if (!obj || !obj.id) return;
            if (obj.type === 'H' && !obj.settings) {
                obj.settings = {};
                if (debugMode) console.log(`Bake: Initialized empty settings for H ID ${obj.id} (null safety)`);
            }
            const id = obj.id;
            if (id && bakedChanges[id]) {
                const changes = bakedChanges[id];
                if (changes.scale && (obj.type === 'P' || obj.type === 'H')) {
                    obj.scale = changes.scale;
                    if (debugMode) console.log(`Bake: Added scale to prop ID ${id} (${obj.type}): ${obj.scale.x.toFixed(2)}x`);
                    bakedCount++;
                }
                if (changes.opacity !== undefined) {
                    obj.opacity = changes.opacity;
                    if (debugMode) console.log(`Bake: Added opacity to ${obj.type || 'shape'} ID ${id}: ${obj.opacity.toFixed(1)}`);
                    bakedCount++;
                }
                if (changes.zIndex !== undefined) {
                    obj.zIndex = changes.zIndex;
                    if (debugMode) console.log(`Bake: Added zIndex to ${obj.type} ID ${id}: ${obj.zIndex}`);
                    bakedCount++;
                }
                if (changes.size !== undefined) {
                    obj.size = changes.size;
                    if (debugMode) console.log(`Bake: Added size to ${obj.type} ID ${id}: ${obj.size.toFixed(2)}x`);
                    bakedCount++;
                }
                if (changes.position !== undefined) {
                    obj.x = changes.position.x;
                    obj.y = changes.position.y;
                    if (debugMode) console.log(`Bake: Added position (${obj.x.toFixed(1)}, ${obj.y.toFixed(1)}) to ID ${id}`);
                    bakedCount++;
                }
            }
        });
        if (debugMode) console.log(`Bake: Modified ${bakedCount} of ${screenObjects.length} screenObjects`);
        return screenObjects;
    }

    const originalOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        const urlStr = url.toString();
        if (debugMode) console.log('NET DEBUG: XHR to', urlStr, '- Method:', method);
        const isMapSave = urlStr.includes('/maps/') && (method === 'PUT' || method === 'POST' || method === 'PATCH');
        if (isMapSave) {
            console.log('Bake: XHR save intercepted!', {url: urlStr, method});
            const origSend = this.send;
            this.send = function(body) {
                console.log('Bake: XHR send - Original body type/len:', typeof body, body?.length || 0);
                try {
                    let bodyObj = body;
                    let wasString = false;
                    if (typeof body === 'string') {
                        wasString = true;
                        bodyObj = JSON.parse(body);
                        console.log('Bake: Parsed string to object (len:', body.length, ')');
                    } else if (body && typeof body === 'object') {
                        console.log('Bake: Direct object body - Has data?', !!bodyObj.data);
                    } else {
                        return origSend.call(this, body);
                    }

                    let modified = false;
                    if (bodyObj?.data && typeof bodyObj.data === 'string') {
                        let mapData;
                        try {
                            mapData = JSON.parse(bodyObj.data);
                            if (mapData?.screenObjects && Array.isArray(mapData.screenObjects)) {
                                console.log('Bake: screenObjects found (length:', mapData.screenObjects.length, ')- Applying');
                                bakeIntoScreenObjects(mapData.screenObjects);
                                bodyObj.data = JSON.stringify(mapData);
                                modified = true;
                                console.log('Bake: Inner data injected (new len:', bodyObj.data.length, ')');
                            } else {
                                console.log('Bake: No screenObjects - Data snippet:', bodyObj.data.substring(0, 200));
                            }
                        } catch (parseErr) {
                            console.error('Bake: Parse data error:', parseErr);
                        }
                    } else {
                        console.log('Bake: No "data" field or not string - Skipping');
                    }

                    let sendBody = body;
                    if (wasString && modified) {
                        sendBody = JSON.stringify(bodyObj);
                        console.log('Bake: Full body re-stringified (old len:', body.length, '→ new len:', sendBody.length, ')');
                    }

                    bakedChanges = {};
                    console.log('Bake: Forwarding', modified ? 'modified' : 'original', 'body');
                    return origSend.call(this, sendBody);
                } catch (e) {
                    console.error('Bake XHR error:', e);
                    return origSend.call(this, body);
                }
            };
        }
        return originalOpen.apply(this, arguments);
    };

    console.log('Full script: XHR hook ready');

    function hookAppSaveMap() {
        if (window.app && typeof window.app.saveMap === 'function') {
            const origSave = window.app.saveMap;
            window.app.saveMap = function(...args) {
                console.log('Bake: app.saveMap intercepted! Args:', args.length);
                let mapData = args[0] || window.app.currentMapData || window.app.mapData;
                if (mapData?.data && typeof mapData.data === 'string') {
                    let parsed = JSON.parse(mapData.data);
                    if (parsed?.screenObjects) {
                        console.log('Bake: Internal screenObjects - Applying');
                        bakeIntoScreenObjects(parsed.screenObjects);
                        mapData.data = JSON.stringify(parsed);
                        console.log('Bake: Internal injection done');
                    }
                }
                return origSave.apply(this, args);
            };
            console.log('Bake: Hooked app.saveMap');
        } else {
            console.log('Bake: No app.saveMap found');
        }
    }

    function patchShapeCreation() {
        if (window.app && window.app.createShape) {
            const origCreate = window.app.createShape;
            window.app.createShape = function(type, ...args) {
                const shape = origCreate.call(this, type, ...args);
                if (type === 'H' && shape && !shape.settings) {
                    shape.settings = {};
                    if (debugMode) console.log('patchShapeCreation: Initialized settings for new H shape');
                }
                return shape;
            };
            console.log('patchShapeCreation: Hooked shape creation');
        } else {
            setInterval(() => {
                if (window.app?.layers) {
                    window.app.layers.forEach(layer => {
                        if (layer?.children) {
                            layer.children.forEach(shape => {
                                if (shape.type === 'H' && !shape.settings) {
                                    shape.settings = {};
                                    if (debugMode) console.log('patchShapeCreation: Fixed existing H settings (poll)');
                                }
                            });
                        }
                    });
                }
            }, 2000);
            console.log('patchShapeCreation: Fallback poll active');
        }
    }


    window.bakedChanges = bakedChanges;
    window.bakeIntoScreenObjects = bakeIntoScreenObjects;

    console.log('Internal hooks');

    function getSelectedShapes(silent = false) {
        try {
            if (!window.app) {
                if (!silent && debugMode) console.log('getSelectedShapes: window.app missing');
                return [];
            }
            if (window.app._selectedObjects && window.app._selectedObjects.length > 0) {
                const shapes = window.app._selectedObjects;
                if (!silent && debugMode) console.log('getSelectedShapes: Found multi-select', { count: shapes.length, types: shapes.map(s => s.type) });
                return shapes;
            }
            if (window.selectedShape) {
                if (!silent && debugMode) console.log('getSelectedShapes: Found single selectedShape');
                return [window.selectedShape];
            }
            if (window.app.selectedLayer && window.app.selectedLayer.children && window.app.selectedLayer.children.length > 0) {
                if (!silent && debugMode) console.log('getSelectedShapes: Found single selectedLayer child');
                return [window.app.selectedLayer.children[0]];
            }
            if (!silent && debugMode) console.log('getSelectedShapes: No selection found');
            return [];
        } catch (e) {
            console.error('getSelectedShapes error:', e);
            return [];
        }
    }

    function getSelectedShape(silent = false) {
        const shapes = getSelectedShapes(silent);
        return shapes.length > 0 ? shapes[0] : null;
    }

    function isObjectSelected(silent = false) {
        const selected = getSelectedShapes(silent).length > 0;
        if (!silent && debugMode) console.log('isObjectSelected:', selected, `(count: ${getSelectedShapes(silent).length})`);
        return selected;
    }

    function getPosition(obj) {
        try {
            return {
                x: obj.x || (obj.position && obj.position.x) || 0,
                y: obj.y || (obj.position && obj.position.y) || 0
            };
        } catch (e) {
            console.error('getPosition error:', e);
            return { x: 0, y: 0 };
        }
    }


    function nudgeSelectedPoints(shape, deltaX, deltaY) {
        try {
            const selectedPoints = shape.selectedPoints || [];
            if (selectedPoints.length === 0) {
                console.warn('nudgeSelectedPoints: No selected points - select polygon vertices first', { type: shape?.type, id: shape?.id });
                return false;
            }

            if (!shape.points || shape.points.length === 0) {
                console.warn('nudgeSelectedPoints: Shape has no points array', { type: shape?.type, id: shape?.id });
                return false;
            }

            let updatedCount = 0;
            let snappedCount = 0;
            let needsRedraw = false;

            selectedPoints.forEach((selPoint, idx) => {
                let mainIndex = shape.points.findIndex(p => p === selPoint);

                if (mainIndex === -1) {
                    mainIndex = shape.points.findIndex(p => {
                        return (p.x === selPoint.x && p.y === selPoint.y) ||
                            (p.position && selPoint.position && p.position.x === selPoint.position.x && p.position.y === selPoint.position.y);
                    });
                }

                if (mainIndex === -1) {
                    console.warn(`nudgeSelectedPoints: Selected point #${idx} not found in main points, skipping`);
                    return;
                }

                const point = shape.points[mainIndex];
                if (!point) return;

                const oldX = point.x !== undefined ? point.x : (point.position ? point.position.x : 0);
                const oldY = point.y !== undefined ? point.y : (point.position ? point.position.y : 0);

                const newX = oldX + deltaX;
                const newY = oldY + deltaY;


                if (point.x !== undefined && point.y !== undefined) {
                    point.x = newX;
                    point.y = newY;
                } else if (point.position) {
                    point.position.x = newX;
                    point.position.y = newY;
                } else {
                    console.warn('nudgeSelectedPoints: Invalid point structure at mainIndex', mainIndex);
                    return;
                }

                const allPointsForSnap = getAllPointsInLayer(shape);
                const snapped = snapPoint(point, allPointsForSnap);
                if (snapped) snappedCount++;


                if (selPoint !== point) {
                    if (selPoint.x !== undefined && selPoint.y !== undefined) {
                        selPoint.x = point.x;
                        selPoint.y = point.y;
                    } else if (selPoint.position) {
                        selPoint.position.x = point.x;
                        selPoint.position.y = point.y;
                    }
                }

                updatedCount++;
                needsRedraw = true;
                if (debugMode) console.log(`nudgeSelectedPoints: Moved selected point #${idx + 1} (main index ${mainIndex}) to (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
            });

            if (updatedCount > 0 && needsRedraw && typeof shape.redraw === 'function') {
                shape.redraw();
                shape.updatePoints();
                console.log(`nudgeSelectedPoints: SUCCESS - Updated ${updatedCount} points (${snappedCount} snapped) on ${shape.type} ID ${shape.id} `);
                return true;
            } else {
                console.warn('nudgeSelectedPoints: No points updated');
                return false;
            }
        } catch (e) {
            console.error('nudgeSelectedPoints error:', e);
            return false;
        }
    }


    function snapPoint(point, allPoints, threshold = snapThreshold) {
        if (!snappingEnabled) return point;
        let closest = null;
        let minDist = threshold;
        allPoints.forEach(other => {
            if (other === point) return;
            const dx = other.x - point.x;
            const dy = other.y - point.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < minDist) {
                minDist = dist;
                closest = other;
            }
        });
        if (closest) {
            point.x = closest.x;
            point.y = closest.y;
            if (debugMode) console.log(`Snapped point to (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
            return true;
        }
        return false;
    }

    function nudgeSelectedPoint(shape, deltaX, deltaY) {
        return nudgeSelectedPoints(shape, deltaX, deltaY);
    }

    function nudgeWholeShape(shape, deltaX, deltaY) {
        try {
            const pos = getPosition(shape);
            const newX = pos.x + deltaX;
            const newY = pos.y + deltaY;
            if (shape.x !== undefined) {
                shape.x = newX;
                shape.y = newY;
            } else if (shape.position) {
                shape.position.x = newX;
                shape.position.y = newY;
            }
            if (typeof shape.redraw === 'function') {
                shape.redraw();
                shape.updatePoints();
            }
            if (debugMode) console.log(`nudgeWholeShape: SUCCESS - Position to (${newX.toFixed(1)}, ${newY.toFixed(1)}) for ${shape.type} ID ${shape.id}`);
            return true;
        } catch (e) {
            console.error('nudgeWholeShape error:', e);
            return false;
        }
    }

    function getAllPointsInLayer(shape) {
        let allPoints = [...(shape.points || [])];
        if (window.app && window.app.selectedLayer && window.app.selectedLayer.children) {

            window.app.selectedLayer.children.forEach(sibling => {
                if (sibling !== shape && sibling.points && Array.isArray(sibling.points)) {
                    allPoints = allPoints.concat(sibling.points);
                }
            });
            window.app.layers.forEach(layer => {
                try {
                    layer.children.forEach(sibling => {
                        if (sibling !== shape && sibling.points && Array.isArray(sibling.points)) {
                            allPoints = allPoints.concat(sibling.points);
                        }
                    });
                }
                catch {}
            });
        } else if (window.pixiApp?.stage?.children) {

            window.pixiApp.stage.children.forEach(sibling => {
                if (sibling !== shape && sibling.points && Array.isArray(sibling.points)) {
                    allPoints = allPoints.concat(sibling.points);
                }
            });
        }
        if (debugMode) console.log(`getAllPointsInLayer: Collected ${allPoints.length} points from layer/stage`);
        return allPoints;
    }

    function applyNudge(deltaX, deltaY, forceWhole = false) {
        try {
            if (debugMode) console.log('applyNudge: Starting', { deltaX, deltaY, forceWhole, forceIndividualMode, forceWholeMode });
            const shapes = getSelectedShapes(true);
            if (shapes.length === 0) {
                if (debugMode) console.log('applyNudge: No shapes selected, skipping');
                return;
            }

            let totalSuccess = 0;
            shapes.forEach((shape, idx) => {
                if (debugMode) console.log(`applyNudge: Processing shape ${idx + 1}/${shapes.length}`, { type: shape.type, id: shape.id, hasPoints: !!shape.points, pointsLength: shape.points?.length || 0 });

                let success = false;

                if (shape.points && shape.points.length > 0) {
                    const selectedPoints = shape.selectedPoints || [];
                    const totalPoints = shape.points.length;
                    const isPartialMode = selectedPoints.length > 0 && selectedPoints.length < totalPoints;
                    const isWholeMode = forceWhole || forceWholeMode || selectedPoints.length === 0 || selectedPoints.length === totalPoints;
                    const useIndividual = forceIndividualMode || isPartialMode;

                    if (useIndividual) {

                        success = nudgeSelectedPoints(shape, deltaX, deltaY);
                        if (debugMode) console.log(`applyNudge: Individual mode applied on shape ID ${shape.id}`);

                    } else {

                        let updatedCount = 0;
                        let snappedCount = 0;
                        let needsRedraw = false;
                        shape.points.forEach((point, pIdx) => {
                            if (!point) return;
                            const oldX = point.x !== undefined ? point.x : (point.position ? point.position.x : 0);
                            const oldY = point.y !== undefined ? point.y : (point.position ? point.position.y : 0);
                            const newX = oldX + deltaX;
                            const newY = oldY + deltaY;

                            if (point.x !== undefined && point.y !== undefined) {
                                point.x = newX;
                                point.y = newY;
                            } else if (point.position) {
                                point.position.x = newX;
                                point.position.y = newY;
                            } else {
                                console.warn('applyNudge: Invalid point at', pIdx);
                                return;
                            }
                            const allPointsForSnap = getAllPointsInLayer(shape);
                            const snapped = snapPoint(point, allPointsForSnap);
                            if (snapped) snappedCount++;
                            updatedCount++;
                            needsRedraw = true;
                        });
                        if (updatedCount > 0 && needsRedraw && typeof shape.redraw === 'function') {
                            shape.redraw();
                            shape.updatePoints();
                            success = true;
                            if (debugMode) console.log(`applyNudge: Whole mode - Nudged all ${updatedCount} points (${snappedCount} snapped) on shape ID ${shape.id}`);
                        }
                    }

                } else {

                    success = nudgeWholeShape(shape, deltaX, deltaY);
                }


                if (success && shape.x !== undefined && shape.y !== undefined) {
                    storeBakedChange(shape.id, 'position', { x: shape.x, y: shape.y });
                }

                if (success) totalSuccess++;
                else if (debugMode) console.log(`applyNudge: Failed on shape ${idx + 1} (${shape.type})`);
            });

            if (totalSuccess > 0) {

                if (window.pixiApp?.renderer?.render) {
                    if (applyNudge._renderTimeout) clearTimeout(applyNudge._renderTimeout);
                    applyNudge._renderTimeout = setTimeout(() => {
                        window.pixiApp.renderer.render(window.pixiApp.stage);
                        refreshCanvasBounds();
                        if (debugMode) console.log('applyNudge: Global render and refreshCanvasBounds called');
                    }, 50);
                }
                if (debugMode) console.log(`applyNudge: Overall success - ${totalSuccess}/${shapes.length} shapes`);
            }
        } catch (e) {
            console.error('applyNudge error:', e);
        }
    }

    function areShapesFlippable(shapes) {
        let failureFlag = true;
        if (shapes.length <= 0 || !shapes) {
            failureFlag = false;
        }

        shapes.forEach(shape => {
            if (!shape.points || shape.points.length < 3) {
                failureFlag = false;
            }
        })
        return failureFlag;
    }

    function flipShapePointsHorizontal(shapes, aboutWorldCenter) {
        if (!areShapesFlippable(shapes)) {
            if (debugMode) console.log('flipShapePointsHorizontal: Invalid shapes/points - skip');
            return false;
        }

        let centerX = 0;
        if (aboutWorldCenter) {
            centerX = window.app.layers[0].width / 2;
        }
        else {
            let points = 0;
            shapes.forEach(s => {
                s.points.forEach(p => {
                    centerX += p.x;
                    points++;
                })
            })
            centerX /= points;
        }

        shapes.forEach(s => {
            s.points.forEach(point => {
                const dx = point.x - centerX;
                point.x = centerX - dx;
            });
        })

        shapes.forEach(shape => {
            if (typeof shape.redraw === 'function') {
                shape.redraw();
                shape.updatePoints();
            }
        })

        refreshCanvasBounds();
        if (debugMode) console.log(`flipShapePointsHorizontal: Flipped ${shapes.length} shapes (first type is ${shapes[0].type || 'shape'}) horizontally`);
        return true;
    }


    function flipShapePointsVertical(shapes) {
        if (!areShapesFlippable(shapes)) {
            if (debugMode) console.log('flipShapePointsVertical: Invalid shape/points - skip');
            return false;
        }

        let centerY = 0;
        let points = 0;
        shapes.forEach(s => {
            s.points.forEach(p => {
                centerY += p.y;
                points++;
            })
        })
        centerY /= points;

        shapes.forEach(s => {
            s.points.forEach(point => {
                const dy = point.y - centerY;
                point.y = centerY - dy;
            });
        })

        shapes.forEach(shape => {
            if (typeof shape.redraw === 'function') {
                shape.redraw();
                shape.updatePoints();
            }
        })

        refreshCanvasBounds();
        if (debugMode) console.log(`flipShapePointsVertical: Flipped ${shapes.length} shapes (first type is ${shapes[0].type || 'shape'}) vertically`);
        return true;
    }
    function applyFlipHorizontal(aboutWorldCenter) {
        try {
            const shapes = getSelectedShapes();
            if (!shapes) {
                if (debugMode) console.log('applyFlipHorizontal: No shape selected');
                return;
            }
            const success = flipShapePointsHorizontal(shapes, aboutWorldCenter);
            if (success && window.pixiApp?.renderer?.render) {
                window.pixiApp.renderer.render(window.pixiApp.stage);
            }
        } catch (e) {
            console.error('applyFlipHorizontal error:', e);
        }
    }

    function applyFlipVertical() {
        try {
            const shapes = getSelectedShapes();
            if (!shapes) {
                if (debugMode) console.log('applyFlipVertical: No shape selected');
                return;
            }
            const success = flipShapePointsVertical(shapes);
            if (success && window.pixiApp?.renderer?.render) {
                window.pixiApp.renderer.render(window.pixiApp.stage);
            }
        } catch (e) {
            console.error('applyFlipVertical error:', e);
        }
    }

    function scaleShapesWrapper(enlarge) {
        try {
            const shapes = getSelectedShapes();
            if (!shapes) {
                if (debugMode) console.log('applyFlipVertical: No shape selected');
                return;
            }
            const success = scaleShapes(shapes, enlarge);
            if (success && window.pixiApp?.renderer?.render) {
                window.pixiApp.renderer.render(window.pixiApp.stage);
            }
        } catch (e) {
            console.errpr('scaling shape error:', e);
        }
    }

    function scaleShapes(shapes, enlarge) {
        if (!areShapesFlippable(shapes)) {
            if (debugMode) console.log('scaleShapes: Invalid shape/points - skip');
            return false;
        }

        let centerX = 0;
        let centerY = 0;
        let points = 0;
        shapes.forEach(s => {
            s.points.forEach(p => {
                centerX += p.x;
                centerY += p.y;
                points++;
            })
        })
        centerY /= points;
        centerX /= points;

        let factor = 0.9;
        if (enlarge) {
            factor = 1.1;
        }
        shapes.forEach(s => {
            s.points.forEach(point => {
                const dx = point.x - centerX;
                const dy = point.y - centerY;
                point.x = centerX + factor * dx;
                point.y = centerY + factor * dy;
            });
        })

        shapes.forEach(shape => {
            if (typeof shape.redraw === 'function') {
                shape.redraw();
                shape.updatePoints();
            }
        })

        refreshCanvasBounds();
        if (debugMode) console.log(`scaleShapes: Scaled ${shapes.length} shapes (first type is ${shapes[0].type || 'shape'})`);
        return true;
    }

    function rotateShapePoints(shape, angleDegrees) {
        if (!shape || !shape.points || shape.points.length < 3) {
            if (debugMode) console.log('rotateShapePoints: Invalid shape/points - skip');
            return false;
        }

        const angleRad = (angleDegrees * Math.PI) / 180;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);

        let centerX = 0, centerY = 0;
        shape.points.forEach(p => {
            centerX += p.x;
            centerY += p.y;
        });
        centerX /= shape.points.length;
        centerY /= shape.points.length;

        shape.points.forEach(point => {
            const dx = point.x - centerX;
            const dy = point.y - centerY;
            point.x = centerX + (dx * cosA - dy * sinA);
            point.y = centerY + (dx * sinA + dy * cosA);
        });


        let newCenterX = 0, newCenterY = 0;
        shape.points.forEach(p => {
            newCenterX += p.x;
            newCenterY += p.y;
        });
        newCenterX /= shape.points.length;
        newCenterY /= shape.points.length;

        const driftX = Math.abs(newCenterX - centerX);
        const driftY = Math.abs(newCenterY - centerY);
        const totalDrift = Math.sqrt(driftX * driftX + driftY * driftY);

        if (typeof shape.redraw === 'function') {
            shape.redraw();
            shape.updatePoints();
        }

        if (totalDrift > 0.1) {
            const lerpSteps = totalDrift > 1 ? 3 : 1;
            let step = 0;
            const syncStep = () => {
                step++;
                shape.x = shape.x + (newCenterX - shape.x) * (step / lerpSteps);
                shape.y = shape.y + (newCenterY - shape.y) * (step / lerpSteps);
                if (step < lerpSteps) requestAnimationFrame(syncStep);
            };
            requestAnimationFrame(syncStep);
        }

        shape.updatePoints();

        if (debugMode) console.log(`rotateShapePoints: Rotated ${shape.type || 'shape'} by ${angleDegrees}° around center`);
        return true;
    }

    function applyRotation(angleDegrees, forceWhole = false) {
        try {
            const shape = getSelectedShape();
            if (!shape) {
                if (debugMode) console.log('applyRotation: No shape, skipping');
                return;
            }

            let isWhole = forceWhole || !(shape.selectedPoints && shape.selectedPoints.length > 0);
            if (!isWhole) {
                if (debugMode) console.log('applyRotation: Vertex selected - select whole shape for rotation');
                return;
            }

            const success = rotateShapePoints(shape, angleDegrees);

            if (success) {
                if (window.pixiApp?.renderer?.render) {
                    window.pixiApp.renderer.render(window.pixiApp.stage);
                }
                refreshCanvasBounds();
                if (debugMode) console.log(`applyRotation: Success - ${shape.type || 'shape'} rotated ${angleDegrees}°`);
            }
        } catch (e) {
            console.error('applyRotation error:', e);
        }
    }

    function applyEyedrop(idx) {
        try {
            if (!isObjectSelected()) {
                if (debugMode) console.log('Eyedrop: No shape selected');
                return;
            }
            const shape = getSelectedShape();
            if (!shape.colors || shape.colors.length < 2) {
                if (debugMode) console.log('Eyedrop: Selected shape has no gradient');
                return;
            }

            if ('EyeDropper' in window) {
                new EyeDropper().open()
                    .then(result => {
                    const hex = result.sRGBHex;
                    const color = parseInt(hex.slice(1), 16);
                    shape.colors[idx] = color;
                    if (typeof shape.redraw === 'function') {
                        shape.redraw();
                        setTimeout(() => shape.redraw(), 50);
                    }
                    refreshCanvasBounds();
                    if (debugMode) console.log(`Eyedrop: Set ${idx === 0 ? 'top' : 'bottom'} color to 0x${color.toString(16).toUpperCase()}`);
                })
                    .catch(err => {
                    if (debugMode) console.log('Eyedrop: API canceled or error:', err);
                });
            } else {
                if (debugMode) console.log('Eyedrop: Browser Eyedropper API unsupported');
            }
        } catch (e) {
            console.error('Eyedrop: applyEyedrop error:', e);
        }
    }

    function toggleFlipGradient() {
        try {
            if (!isObjectSelected()) return;
            const shape = getSelectedShape();
            if (!shape.colors || shape.colors.length < 2) return;

            flipMode = !flipMode;


            if (flipMode) {
                const temp = shape.colors[0];
                shape.colors[0] = shape.colors[1];
                shape.colors[1] = temp;
            } else {

            }

            if (typeof shape.redraw === 'function') shape.redraw();
            refreshCanvasBounds();
            if (debugMode) console.log(`toggleFlipGradient: Now ${flipMode ? 'flipped' : 'normal'}`);
        } catch (e) {
            console.error('toggleFlipGradient error:', e);
            flipMode = !flipMode;
        }
    }


    function refreshCanvasBounds() {
        try {
            if (!window.app || !window.app.viewport) return;
            if (window.pixiApp?.renderer?.render) {
                window.pixiApp.renderer.render(window.pixiApp.stage);
            }
            window.app.viewport.dirty = true;
            if (debugMode) console.log('refreshCanvasBounds: Rendered');
        } catch (e) {
            console.error('refreshCanvasBounds error:', e);
        }
    }



    function handleKey(event) {
        try {

            const target = event.target;
            const tagName = target.tagName ? target.tagName.toLowerCase() : '';
            const isEditable = target.isContentEditable;
            if (tagName === 'input' || tagName === 'textarea' || isEditable) {
                return;
            }

            const key = event.key.toLowerCase();
            if (debugMode) console.log('handleKey: Key pressed', { key, ctrl: event.ctrlKey, shift: event.shiftKey });

            let prevent = false;
            let shouldPushToHistory = false;

            if ((key === '+' || key === '=') && !event.ctrlKey && !event.altKey) {
                const shape = getSelectedShape();
                if (shape && (shape._texture || shape.texture)) {
                    scaleProp(shape, 0.1);
                    prevent = true;
                }
            } else if (key === '-' && !event.ctrlKey && !event.altKey) {
                const shape = getSelectedShape();
                if (shape && (shape._texture || shape.texture)) {
                    scaleProp(shape, -0.1);
                    prevent = true;
                }
            }

            if (key === 'x' && event.shiftKey) {
                snappingEnabled = !snappingEnabled;
                console.log(`Snapping: ${snappingEnabled ? 'ON' : 'OFF'}`);
                prevent = true;
            }

            if (key === 'i' && event.shiftKey) {
                const shape = getSelectedShape();
                if (shape && shape.points && shape.type !== 'H') {
                    forceIndividualMode = !forceIndividualMode;
                    forceWholeMode = false;
                    console.log(`TOGGLE: Individual mode ${forceIndividualMode ? 'ON' : 'OFF'} for polygon ID ${shape.id}`);
                    prevent = true;
                    return;
                }
            }

            if (key === 'w') {
                const shape = getSelectedShape();
                if (shape && shape.points) {
                    forceWholeMode = !forceWholeMode;
                    forceIndividualMode = false;
                    console.log(`TOGGLE: Whole mode ${forceWholeMode ? 'ON' : 'OFF'} for polygon ID ${shape.id}`);
                    prevent = true;
                    return;
                }
            }

            if (key === '>' && event.shiftKey) {
                const shape = getSelectedShape();
                if (shape) {
                    const newZ = Math.min(100, (shape.zIndex || 0) + 10);
                    shape.zIndex = newZ;
                    storeBakedChange(shape.id, 'zIndex', newZ);
                    if (shape.parent) {
                        shape.parent.sortableChildren = true;
                        shape.parent.sortChildren();
                    }
                    refreshCanvasBounds();
                    prevent = true;
                }
            } else if (key === '<' && event.shiftKey) {
                const shape = getSelectedShape();
                if (shape) {
                    const newZ = Math.max(-100, (shape.zIndex || 0) - 10);
                    shape.zIndex = newZ;
                    storeBakedChange(shape.id, 'zIndex', newZ);
                    if (shape.parent) {
                        shape.parent.sortableChildren = true;
                        shape.parent.sortChildren();
                    }
                    refreshCanvasBounds();
                    prevent = true;
                }
            }

            if ((key === '{' || key === '}') && event.shiftKey) {
                const shape = getSelectedShape();
                if (shape) {
                    const delta = (key === '}' && event.shiftKey) ? 0.1 : -0.1;
                    adjustTransparency(shape, delta);
                    prevent = true;
                } else if (debugMode) {
                    console.log('handleKey: [ / ] ignored - Select a prop or polygon first');
                }
            }

            if (key === '~' && event.shiftKey) {
                applyNudge(10, 10);
                prevent = true;
            }
            if (key === '1') {
                applyNudge(0.1, 0);
                prevent = true;
                shouldPushToHistory = true;
            } else if (key === '2') {
                applyNudge(-0.1, 0);
                prevent = true;
                shouldPushToHistory = true;
            } else if (key === '3') {
                applyNudge(0, -0.1);
                prevent = true;
                shouldPushToHistory = true;
            } else if (key === '4') {
                applyNudge(0, 0.1);
                prevent = true;
                shouldPushToHistory = true;
            } else if (key === 'z' && !event.ctrlKey) {
                applyNudge(0, 0);
                prevent = true;
                shouldPushToHistory = true;
            }


            if (key === 'f' && event.shiftKey) {
                toggleFlipGradient();
                prevent = true;
            }



            if (key === 'q' || key === 'e') {
                const isQ = key === 'q';
                const angle = (event.shiftKey ? 45 : 5) * (isQ ? 1 : -1);
                applyRotation(angle);
                prevent = true;
                shouldPushToHistory = true;
            }

            if (key === 'a' && event.shiftKey) {
                applyFlipHorizontal(event.ctrlKey);
                prevent = true;
                shouldPushToHistory = true;
            }


            if (key === 'd' && event.shiftKey) {
                applyFlipVertical();
                prevent = true;
                shouldPushToHistory = true;
            }

            if (key === 's' && event.shiftKey) {
                scaleShapesWrapper(event.altKey);
                prevent = true;
                shouldPushToHistory = true;
            }

            if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
                const multiplier = event.shiftKey ? 5 : 1;
                const delta = baseNudgeAmount * multiplier;
                let deltaX = 0, deltaY = 0;
                switch (key) {
                    case 'arrowleft': deltaX = -delta; break;
                    case 'arrowright': deltaX = delta; break;
                    case 'arrowup': deltaY = -delta; break;
                    case 'arrowdown': deltaY = delta; break;
                }
                applyNudge(deltaX, deltaY);
                prevent = true;
                shouldPushToHistory = true;
            }

            if (key === '9' || key === '0') {
                const idx = key === '9' ? 0 : 1;
                applyEyedrop(idx);
                prevent = true;
                shouldPushToHistory = true;
            }

            if (shouldPushToHistory) {
                window.app.pushToHistory(window.app.selectedObjects);
            }

            if (prevent) {
                event.preventDefault();
                event.stopPropagation();
                if (debugMode) console.log('handleKey: Prevented default/propagation');
            }
        } catch (e) {
            console.error('handleKey error:', e);
        }
    }


    function scaleProp(shape, deltaScale) {
        try {
            if (!shape || !shape._texture && !shape.texture) {
                if (debugMode) console.log('scaleProp: Not a prop - Select a PNG sprite');
                return false;
            }
            if (!shape.scale || typeof shape.scale.x !== 'number') {
                if (debugMode) console.log('scaleProp: Prop missing valid scale');
                return false;
            }

            const oldScaleX = shape.scale.x;
            const oldScaleY = shape.scale.y;
            const newScaleX = Math.max(0.1, Math.min(10.0, oldScaleX + deltaScale));
            const newScaleY = Math.max(0.1, Math.min(10.0, oldScaleY + deltaScale));

            shape.scale.x = newScaleX;
            shape.scale.y = newScaleY;
            storeBakedChange(shape.id, 'scale', {x: newScaleX, y: newScaleY});

            let centerX, centerY;
            if (shape._size && shape._size.width && shape._size.height) {
                const posX = shape.position ? shape.position.x : (shape.x || 0);
                const posY = shape.position ? shape.position.y : (shape.y || 0);
                centerX = posX + (shape._size.width * oldScaleX) / 2;
                centerY = posY + (shape._size.height * oldScaleY) / 2;
                const newWidth = shape._size.width * newScaleX;
                const newHeight = shape._size.height * newScaleY;
                const newPosX = centerX - newWidth / 2;
                const newPosY = centerY - newHeight / 2;
                if (shape.position) {
                    shape.position.x = newPosX;
                    shape.position.y = newPosY;
                } else {
                    shape.x = newPosX;
                    shape.y = newPosY;
                }
            }

            refreshCanvasBounds();
            if (debugMode) console.log(`scaleProp: Resized to ${newScaleX.toFixed(2)}x / ${newScaleY.toFixed(2)}y`);
            return true;
        } catch (e) {
            console.error('scaleProp error:', e);
            return false;
        }
    }

    function adjustTransparency(shape, deltaAlpha) {
        try {
            if (!shape) return false;

            let currentAlpha = 1.0;
            let isProp = shape._texture || shape.texture;
            let isPolygon = shape.points && (shape.colors || shape.shape || shape.lines);
            let isBg = shape.type === 'Bg';

            if (isProp) {
                currentAlpha = shape.alpha || 1.0;
            } else if (isPolygon || isBg) {
                let fillObj = shape.shape || shape.lines || shape;
                currentAlpha = (fillObj._fillStyle ? fillObj._fillStyle.alpha : fillObj.alpha) || 1.0;
                if (isBg) currentAlpha = shape.alpha || (shape._opacity !== undefined ? shape._opacity : 1.0);
            } else {
                if (debugMode) console.log('adjustTransparency: Unsupported shape type');
                return false;
            }

            const newAlpha = Math.max(0.0, Math.min(1.0, currentAlpha + deltaAlpha));
            storeBakedChange(shape.id, 'opacity', newAlpha);

            if (window.app && window.app.screenObjects) {
                const soObj = window.app.screenObjects[shape.id.toString()];
                if (soObj) soObj.opacity = newAlpha;
            }

            if (isProp) {
                shape.alpha = newAlpha;
            } else if (isPolygon) {
                let fillObj = shape.shape || shape.lines || shape;
                if (fillObj._fillStyle) fillObj._fillStyle.alpha = newAlpha;
                fillObj.alpha = newAlpha;
                if (typeof shape.redraw === 'function') {
                    shape.redraw();
                    setTimeout(() => shape.redraw(), 50);
                }
            } else if (isBg) {
                shape.alpha = newAlpha;
                if (shape._opacity !== undefined) shape._opacity = newAlpha;
                window.app.worldDirty = true;
            }

            refreshCanvasBounds();
            if (debugMode) console.log(`adjustTransparency: Set to ${newAlpha.toFixed(1)}`);
            return true;
        } catch (e) {
            console.error('adjustTransparency error:', e);
            return false;
        }
    }



    function probeGradient(shape, beforeSet = false) {
        if (!debugMode) return;
        console.log(`probeGradient: ${beforeSet ? 'Before' : 'After'} - Shape type: ${shape.type}, Keys:`, Object.keys(shape || {}));
        if (shape.colors) console.log(`probeGradient: Colors: [0x${shape.colors[0]?.toString(16).toUpperCase()}, 0x${shape.colors[1]?.toString(16).toUpperCase()}]`);
        if (shape.fill) console.log(`probeGradient: shape.fill:`, shape.fill);
        if (shape.shape) console.log(`probeGradient: shape.shape._fillStyle:`, shape.shape._fillStyle);
        if (shape.lines) console.log(`probeGradient: shape.lines._fillStyle:`, shape.lines._fillStyle);
        if (shape.container?.children?.length > 0) {
            console.log(`probeGradient: container children: ${shape.container.children.length}`);
        }
        console.log(`probeGradient: PIXI: ${!!window.PIXI}, pixiApp: ${!!window.pixiApp}`);
    }


    function initFeatures() {
        try {
            console.log('initFeatures: Starting initialization');
            if (!window.app) {
                console.log('initFeatures: window.app not ready - retrying...');
                setTimeout(initFeatures, 2000);
                return;
            }

            if (!keyHandler) {
                keyHandler = (event) => handleKey(event);
                document.addEventListener('keydown', keyHandler, true);
                if (window.app.canvas) {
                    window.app.canvas.addEventListener('keydown', keyHandler, true);
                }
                window.addEventListener('keydown', keyHandler, true);
                console.log('initFeatures: Keydown listeners added');
                hookAppSaveMap();
                patchShapeCreation();
                getPixiLib();
                probeGradient({});
            }

            const currentShapes = getSelectedShapes(true);
            if (currentShapes.length === 0 && (forceIndividualMode || forceWholeMode)) {
                forceIndividualMode = false;
                forceWholeMode = false;
                if (debugMode) console.log('initFeatures: Reset force modes (no selection)');
            }

            console.log('%c🎨 Mapmaker+ v777+ Fixed Loaded! 🚀');
            console.log('• Arrows:movement');
            console.log('• E/Q: Rotate 15° (Shift 90°)');
            console.log('• 9/0: Eyedropper (top/bottom)');
            console.log('• F: Toggle gradient flip');
            console.log('• +/-: Resize prop  ');
            console.log('• [ / ]: Transparency');
            console.log('• Z/C: Z-Index (+/-10)');

            console.log('initFeatures: Complete - Features active');
        } catch (e) {
            console.error('initFeatures error:', e);
            setTimeout(initFeatures, 2000);
        }
    }


    function restoreProps(shape) {
        if (!enableRestore) {
            if (debugMode) console.log('restoreProps: SKIPPED (disabled via toggle)');
            return false;
        }
        if (!shape || !shape.id) return false;
        const soObj = window.app?.screenObjects?.[shape.id.toString()];
        if (!soObj) return false;

        let restored = false;

        if ((shape.type === 'H' || shape.type === 'P') && soObj.scale) {
            shape.scale.x = soObj.scale.x || 1.0;
            shape.scale.y = soObj.scale.y || 1.0;
            restored = true;

            if (shape._size && shape._size.width && shape._size.height) {
                const posX = shape.position ? shape.position.x : (shape.x || 0);
                const posY = shape.position ? shape.position.y : (shape.y || 0);
                const baseWidth = shape._size.width;
                const baseHeight = shape._size.height;
                const centerX = posX + (baseWidth * 1.0) / 2;
                const centerY = posY + (baseHeight * 1.0) / 2;
                const newWidth = baseWidth * shape.scale.x;
                const newHeight = baseHeight * shape.scale.y;
                const newPosX = centerX - newWidth / 2;
                const newPosY = centerY - newHeight / 2;
                if (shape.position) {
                    shape.position.x = newPosX;
                    shape.position.y = newPosY;
                } else {
                    shape.x = newPosX;
                    shape.y = newPosY;
                }
            }
        }

        if (soObj.opacity !== undefined) {
            const savedOpacity = soObj.opacity;
            if (shape.type === 'Bg') {
                shape.alpha = savedOpacity;
                if (shape._opacity !== undefined) shape._opacity = savedOpacity;
                let fillObj = shape.shape || shape.lines || shape;
                if (fillObj._fillStyle) fillObj._fillStyle.alpha = savedOpacity;
                fillObj.alpha = savedOpacity;
                shape.alpha = savedOpacity;
                if (shape.container && shape.container.children) {
                    shape.container.children.forEach(child => {
                        if (child.alpha !== undefined) child.alpha = savedOpacity;
                        if (child._fillStyle) child._fillStyle.alpha = savedOpacity;
                    });
                }
                if (typeof shape.redraw === 'function') {
                    shape.redraw();
                    setTimeout(() => shape.redraw(), 50);
                }
                window.app.worldDirty = true;
                if (window.app.backgroundLayer) window.app.backgroundLayer.dirty = true;
                if (debugMode) {
                    console.log(`🔍 restoreProps Bg ID ${shape.id}: Set opacity to ${savedOpacity.toFixed(1)} (alpha: ${shape.alpha}, _opacity: ${shape._opacity})`);
                }
            } else if (shape.points) {
                let fillObj = shape.shape || shape.lines || shape;
                if (fillObj._fillStyle) fillObj._fillStyle.alpha = savedOpacity;
                fillObj.alpha = savedOpacity;
                if (typeof shape.redraw === 'function') {
                    shape.redraw();
                    setTimeout(() => shape.redraw(), 50);
                }
            } else {
                shape.alpha = savedOpacity;
            }
            restored = true;
        }

        if (soObj.zIndex !== undefined) {
            shape.zIndex = soObj.zIndex;
            if (shape.parent) {
                shape.parent.sortableChildren = true;
                shape.parent.sortChildren();
            }
            restored = true;
        }

        if (restored && debugMode) console.log(`restoreProps: Applied to ID ${shape.id} (${shape.type})`);
        return restored;
    }
    function runRestoreOnLoad() {
        if (!enableRestore) {
            if (debugMode) console.log('runRestoreOnLoad: SKIPPED (disabled)');
            return;
        }
        if (!window.app) {
            console.log('runRestoreOnLoad: app not ready - retrying in 2s');
            setTimeout(runRestoreOnLoad, 2000);
            return;
        }

        const layers = window.app.layers || [];
        let restoredCount = 0;
        layers.forEach((layer, layerIdx) => {
            if (layer && layer.children && layer.children.length > 0) {
                layer.children.forEach(child => {
                    if (child.id && (child.type === 'H' || child.type === 'P' || child.type === 'Bg' || child.points)) {
                        if (restoreProps(child)) restoredCount++;
                    }
                });
                if (debugMode) console.log(`runRestoreOnLoad: Scanned Layer ${layerIdx} (${layer.children.length} children)`);
            }
        });

        if (layers.length === 0 && window.pixiApp?.stage?.children) {
            window.pixiApp.stage.children.forEach(child => {
                if (child.id && (child.type === 'H' || child.type === 'P' || child.type === 'Bg' || child.points)) {
                    if (restoreProps(child)) restoredCount++;
                }
            });
        }

        if (debugMode) console.log(`runRestoreOnLoad: Complete - Restored ${restoredCount} shapes (scale/opacity/zIndex from screenObjects)`);
        window.app.worldDirty = false;
        refreshCanvasBounds();
    }
    setTimeout(runRestoreOnLoad, 1500);
    setTimeout(runRestoreOnLoad, 3000);
    setTimeout(runRestoreOnLoad, 5000);


    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initFeatures, 1000);
        });
    } else {
        setTimeout(initFeatures, 1000);
    }

    window.addEventListener('beforeunload', () => {
        if (keyHandler) {
            document.removeEventListener('keydown', keyHandler, true);
            if (window.app?.canvas) {
                window.app.canvas.removeEventListener('keydown', keyHandler, true);
            }
            window.removeEventListener('keydown', keyHandler, true);
            console.log('Cleanup: Key listeners removed');
        }
    });

    window.getSelectedShape = getSelectedShape;
    window.getSelectedShapes = getSelectedShapes;
    window.bakedChanges = bakedChanges;
    window.refreshCanvasBounds = refreshCanvasBounds;
    window.applyNudge = applyNudge;
    console.log('Script: Exposed getSelectedShape, getSelectedShapes, bakedChanges, refreshCanvasBounds, applyNudge globally');

    console.log('IIFE closed');
})();
