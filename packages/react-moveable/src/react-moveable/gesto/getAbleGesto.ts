import { Able, MoveableManagerInterface, MoveableGroupInterface } from "../types";
import { hasClass, IObject } from "@daybrush/utils";
import { convertDragDist, defaultSync } from "../utils";
import Gesto, { GestoOptions } from "gesto";
import BeforeRenderable from "../ables/BeforeRenderable";
import Renderable from "../ables/Renderable";

export function triggerAble(
    moveable: MoveableManagerInterface,
    ableType: string,
    eventOperation: string,
    eventAffix: string,
    eventType: any,
    e: any,
    requestInstant?: boolean,
) {
    const isStart = eventType === "Start";
    const target = moveable.state.target;
    const isRequest = e.isRequest;

    if (
        !target
        || (isStart && eventAffix.indexOf("Control") > -1
            && !isRequest && moveable.areaElement === e.inputEvent.target)
    ) {
        return false;
    }
    // "drag" "Control" "After"
    const eventName = `${eventOperation}${eventAffix}${eventType}`;
    const conditionName = `${eventOperation}${eventAffix}Condition`;
    const isEnd = eventType === "End";
    const isAfter = eventType === "After";
    const isFirstStart = isStart && (
        !moveable.targetGesto || !moveable.controlGesto
        || (!moveable.targetGesto.isFlag() || !moveable.controlGesto.isFlag())
    );

    if (isFirstStart) {
        moveable.updateRect(eventType, true, false);
    }
    if (eventType === "" && !isRequest) {
        convertDragDist(moveable.state, e);
    }
    // const isGroup = eventAffix.indexOf("Group") > -1;
    const ables: Able[] = [...(moveable as any)[ableType]];

    if (isRequest) {
        const requestAble = e.requestAble;

        if (!ables.some(able => able.name === requestAble)) {
            ables.push(...moveable.props.ables!.filter(able => able.name === requestAble));
        }
    }
    if (!ables.length || ables.every(able => able.dragRelation)) {
        return false;
    }
    const eventAbles: Able[] = [BeforeRenderable, ...ables, Renderable].filter((able: any) => able[eventName]);
    const datas = e.datas;

    if (isFirstStart) {
        eventAbles.forEach(able => {
            able.unset && able.unset(moveable);
        });
    }

    const inputEvent = e.inputEvent;
    let inputTarget: Element;

    if (isEnd && inputEvent) {
        inputTarget = document.elementFromPoint(e.clientX, e.clientY) || inputEvent.target;
    }
    let resultCount = 0;

    let isDragStop = false;
    const stop = () => {
        isDragStop = true;
        e.stop?.();
    };
    const results = eventAbles.filter((able: any) => {
        const ableName = able.name;
        const nextDatas = datas[ableName] || (datas[ableName] = {});

        if (isStart) {
            nextDatas.isEventStart = !able[conditionName] || able[conditionName](moveable, e);
        }

        if (nextDatas.isEventStart) {
            const result = able[eventName](moveable, {
                ...e,
                stop,
                resultCount,
                datas: nextDatas,
                originalDatas: datas,
                inputTarget,
            });

            (moveable as any)._emitter.off();
            if (isStart && result === false) {
                nextDatas.isEventStart = false;
            }
            resultCount += result ? 1 : 0;
            return result;
        }
        return false;
    });

    const isUpdate = results.length;
    let isForceEnd = false;

    // end ables
    if (isStart && (isDragStop || (eventAbles.length && !isUpdate))) {
        isForceEnd = isDragStop || eventAbles.filter(able => {
            const ableName = able.name;
            const nextDatas = datas[ableName];

            if (nextDatas.isEventStart) {
                if (able.dragRelation === "strong") {
                    return false;
                }
                // start drag
                return true;
            }
            // cancel event
            return false;
        }).length as any;
    }
    if (isEnd || isForceEnd) {
        moveable.state.gestos = {};

        if ((moveable as MoveableGroupInterface).moveables) {
            (moveable as MoveableGroupInterface).moveables.forEach(childMoveable => {
                childMoveable.state.gestos = {};
            });
        }
    }
    if (isFirstStart && isForceEnd) {
        eventAbles.forEach(able => {
            able.unset && able.unset(moveable);
        });
    }
    if (isStart && !isForceEnd && !isRequest && isUpdate) {
        e?.preventDefault();
    }
    if (moveable.isUnmounted || isForceEnd) {
        return false;
    }
    if ((!isStart && isUpdate && !requestInstant) || isEnd) {
        const flushSync = moveable.props.flushSync || defaultSync;

        flushSync(() => {
            moveable.updateRect(isEnd ? eventType : "", true, false);
            moveable.forceUpdate();
        });

    }
    if (!isStart && !isEnd && !isAfter && isUpdate && !requestInstant) {
        triggerAble(moveable, ableType, eventOperation, eventAffix, eventType + "After", e);
    }
    return true;
}

export function checkMoveableTarget(moveable: MoveableManagerInterface) {
    const dragTarget = moveable.props.dragTarget;

    return (e: { inputEvent: Event }) => {
        const eventTarget = e.inputEvent.target as Element;
        const areaElement = moveable.areaElement;

        return dragTarget && (eventTarget === dragTarget || dragTarget.contains(eventTarget))
            || eventTarget === areaElement
            || (!moveable.isMoveableElement(eventTarget) && !moveable.controlBox.getElement().contains(eventTarget))
            || hasClass(eventTarget, "moveable-area")
            || hasClass(eventTarget, "moveable-padding")
            || hasClass(eventTarget, "moveable-edgeDraggable");
    };
}

export function getTargetAbleGesto(
    moveable: MoveableManagerInterface,
    moveableTarget: HTMLElement | SVGElement,
    eventAffix: string,
) {
    const controlBox = moveable.controlBox.getElement();
    const targets: Array<HTMLElement | SVGElement> = [];
    const dragTarget = moveable.props.dragTarget;

    targets.push(controlBox);

    if (!moveable.props.dragArea || dragTarget) {
        targets.push(moveableTarget);
    }

    return getAbleGesto(moveable, targets, "targetAbles", eventAffix, {
        dragStart: checkMoveableTarget(moveable),
        pinchStart: checkMoveableTarget(moveable),
    });
}
export function getAbleGesto(
    moveable: MoveableManagerInterface,
    target: HTMLElement | SVGElement | Array<HTMLElement | SVGElement>,
    ableType: string,
    eventAffix: string,
    conditionFunctions: IObject<any> = {},
) {
    const isTargetAbles = ableType === "targetAbles";
    const {
        pinchOutside,
        pinchThreshold,
        preventClickEventOnDrag,
        preventClickDefault,
        checkInput,
    } = moveable.props;
    const options: GestoOptions = {
        preventDefault: true,
        preventRightClick: true,
        preventWheelClick: true,
        container: window,
        pinchThreshold,
        pinchOutside,
        preventClickEventOnDrag: isTargetAbles ? preventClickEventOnDrag : false,
        preventClickEventOnDragStart: isTargetAbles ? preventClickDefault : false,
        preventClickEventByCondition: isTargetAbles ? null : (e: MouseEvent) => {
            return moveable.controlBox.getElement().contains(e.target as Element);
        },
        checkInput: isTargetAbles ? checkInput : false,
    };
    const gesto = new Gesto(target!, options);
    const isControl = eventAffix === "Control";

    ["drag", "pinch"].forEach(eventOperation => {
        ["Start", "", "End"].forEach(eventType => {

            gesto.on(`${eventOperation}${eventType}` as any, e => {
                const eventName = e.eventType;

                if (conditionFunctions[eventName] && !conditionFunctions[eventName](e)) {
                    e.stop();
                    return;
                }
                const result = triggerAble(moveable, ableType, eventOperation, eventAffix, eventType, e);

                if (!result) {
                    e.stop();
                } else if (moveable.props.stopPropagation || (eventType === "Start" && isControl)) {
                    e?.inputEvent?.stopPropagation();
                }
            });
        });
    });

    return gesto;
}
