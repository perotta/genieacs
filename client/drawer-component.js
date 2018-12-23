"use strict";

import m from "mithril";

import * as taskQueue from "./task-queue";
import * as store from "./store";
import * as notifications from "./notifications";

function mparam(param) {
  return m("span.parameter", { title: param }, `${param}`);
}

function mval(val) {
  return m("span.value", { title: val }, `${val}`);
}

function renderStaging(staging) {
  let elements = [];
  for (let s of staging) {
    const queueFunc = () => {
      staging.delete(s);
      taskQueue.queueTask(s);
    };
    const cancelFunc = () => {
      staging.delete(s);
    };

    const input = m("input", {
      value: s.parameterValues[0][1],
      oninput: e => {
        e.redraw = false;
        s.parameterValues[0][1] = input.dom.value;
      },
      onkeydown: e => {
        if (e.keyCode === 13) queueFunc();
        else if (e.keyCode === 27) cancelFunc();
        else e.redraw = false;
      },
      oncreate: vnode => {
        vnode.dom.focus();
        vnode.dom.select();
        // Need to prevent scrolling on focus because
        // we're animating height and using overflow: hidden
        vnode.dom.parentNode.parentNode.scrollTop = 0;
      }
    });
    const queue = m("a", { onclick: queueFunc }, "Queue");

    const cancel = m("a", { onclick: cancelFunc }, "Cancel");

    elements.push(
      m(
        ".staging",
        m("span", "Editing ", mparam(s.parameterValues[0][0])),
        input,
        m("div.actions", queue, cancel)
      )
    );
  }
  return elements;
}

function renderQueue(queue) {
  let details = [];
  let devices = {};
  for (let t of queue) {
    devices[t.device] = devices[t.device] || [];
    devices[t.device].push(t);
  }

  for (let [k, v] of Object.entries(devices)) {
    details.push(m("strong", k));
    for (let t of v) {
      let actions = [
        m(
          "a.cancel",
          {
            onclick: () => {
              taskQueue.deleteTask(t);
            }
          },
          "✕"
        )
      ];
      if (t.status === "fault" || t.status === "stale")
        actions.push(
          m(
            "a.retry",
            {
              onclick: () => {
                taskQueue.queueTask(t);
              }
            },
            "↺"
          )
        );

      if (t.name === "setParameterValues")
        details.push(
          m(
            `div.${t.status}`,
            actions,
            "Set ",
            mparam(t.parameterValues[0][0]),
            " to '",
            mval(t.parameterValues[0][1]),
            "'"
          )
        );
      else if (t.name === "refreshObject")
        details.push(
          m(`div.${t.status}`, actions, "Refresh ", mparam(t.parameterName))
        );
      else if (t.name === "reboot")
        details.push(m(`div.${t.status}`, actions, "Reboot"));
      else if (t.name === "factoryReset")
        details.push(m(`div.${t.status}`, actions, "Factory reset"));
      else if (t.name === "addObject")
        details.push(
          m(`div.${t.status}`, actions, "Add ", mparam(t.objectName))
        );
      else if (t.name === "deleteObject")
        details.push(
          m(`div.${t.status}`, actions, "Delete ", mparam(t.objectName))
        );
      else if (t.name === "getParameterValues")
        details.push(
          m(
            `div.${t.status}`,
            actions,
            `Refresh ${t.parameterNames.length} parameters`
          )
        );
      else details.push(m(`div.${t.status}`, actions, t.name));
    }
  }

  return details;
}

function renderNotifications(notifs) {
  const notificationElements = [];

  for (let n of notifs)
    notificationElements.push(
      m(
        "div.notification",
        {
          class: n.type,
          style: "position: absolute;opacity: 0",
          oncreate: vnode => {
            vnode.dom.style.opacity = 1;
          },
          onbeforeremove: vnode => {
            vnode.dom.style.opacity = 0;
            return new Promise(resolve => {
              setTimeout(() => {
                resolve();
              }, 500);
            });
          },
          key: n.timestamp
        },
        n.message
      )
    );
  return notificationElements;
}

const component = {
  view: vnode => {
    const queue = taskQueue.getQueue();
    const staging = taskQueue.getStaging();
    const notifs = notifications.getNotifications();

    let drawerElement, statusElement;
    let notificationElements = renderNotifications(notifs);
    let stagingElements = renderStaging(staging);
    let queueElements = renderQueue(queue);

    function repositionNotifications() {
      let top = 10;
      for (let c of notificationElements) {
        c.dom.style.top = top;
        top += c.dom.offsetHeight + 10;
      }
    }

    function resizeDrawer() {
      let height = statusElement.dom.offsetTop + statusElement.dom.offsetHeight;
      if (stagingElements.length)
        for (let s of stagingElements)
          height = Math.max(height, s.dom.offsetTop + s.dom.offsetHeight);
      else if (vnode.state.mouseIn)
        for (let c of drawerElement.children)
          height = Math.max(height, c.dom.offsetTop + c.dom.offsetHeight);
      drawerElement.dom.style.height = height;
    }

    if (stagingElements.length + queueElements.length) {
      const statusCount = { queued: 0, pending: 0, faulty: 0, stale: 0 };
      for (let t of queue) statusCount[t.status] += 1;

      let actions;
      if (queueElements.length)
        if (statusCount.queued) {
          actions = m(
            ".actions",
            m("a.clear", { onclick: taskQueue.clear }, "Clear"),
            m(
              "a.commit",
              {
                onclick: () => {
                  let tasks = Array.from(taskQueue.getQueue()).filter(
                    t => t.status === "queued"
                  );
                  taskQueue
                    .commit(
                      tasks,
                      (deviceId, connectionRequestStatus, tasks2) => {
                        if (connectionRequestStatus !== "OK")
                          notifications.push(
                            "error",
                            `${deviceId}: ${connectionRequestStatus}`
                          );
                        else
                          for (let t of tasks2)
                            if (t.status === "stale") {
                              notifications.push(
                                "error",
                                `${deviceId}: No contact from device`
                              );
                              return;
                            } else if (t.status === "fault") {
                              notifications.push(
                                "error",
                                `${deviceId}: Task(s) faulted`
                              );
                              return;
                            }

                        notifications.push(
                          "success",
                          `${deviceId}: Task(s) committed`
                        );
                      }
                    )
                    .then(() => {
                      store.fulfill(Date.now(), Date.now());
                    })
                    .catch(err => {
                      notifications.push("error", err.message);
                      throw err;
                    });
                }
              },
              "Commit"
            )
          );
        } else {
          actions = m(
            ".actions",
            m("a.clear", { onclick: taskQueue.clear }, "Clear")
          );
        }

      statusElement = m(
        ".status",
        m(
          "span.queued",
          { class: statusCount.queued ? "active" : "" },
          `Queued: ${statusCount.queued}`
        ),
        m(
          "span.pending",
          { class: statusCount.pending ? "active" : "" },
          `Pending: ${statusCount.pending}`
        ),
        m(
          "span.faulty",
          { class: statusCount.faulty ? "active" : "" },
          `Faulty: ${statusCount.faulty}`
        ),
        m(
          "span.stale",
          { class: statusCount.stale ? "active" : "" },
          `Stale: ${statusCount.stale}`
        ),
        actions
      );

      drawerElement = m(
        ".drawer",
        {
          key: "drawer",
          style: "opacity: 0;height: 0;",
          oncreate: vnode2 => {
            vnode.state.mouseIn = false;
            vnode2.dom.style.opacity = 1;
            resizeDrawer();
          },
          onmouseover: e => {
            vnode.state.mouseIn = true;
            resizeDrawer();
            e.redraw = false;
          },
          onmouseleave: e => {
            vnode.state.mouseIn = false;
            resizeDrawer();
            e.redraw = false;
          },
          onupdate: resizeDrawer,
          onbeforeremove: vnode2 => {
            vnode2.dom.onmouseover = vnode2.dom.onmouseleave = null;
            vnode2.dom.style.opacity = 0;
            vnode2.dom.style.height = 0;
            return new Promise(resolve => {
              setTimeout(resolve, 500);
            });
          }
        },
        statusElement,
        stagingElements.length ? stagingElements : m(".queue", queueElements)
      );
    }

    return m(
      "div.drawer-wrapper",
      drawerElement,
      m(
        "div.notifications-wrapper",
        {
          key: "notifications",
          style: "position: relative;",
          onupdate: repositionNotifications,
          oncreate: repositionNotifications
        },
        notificationElements
      )
    );
  }
};

export default component;
