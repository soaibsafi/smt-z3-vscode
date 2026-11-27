(declare-const Dog Int)
(declare-const Cat Int)
(declare-const Mouse Int)

; You have to buy at least one of each.
(assert (>= Dog 1))
(assert (>= Cat 1))
(assert (>= Mouse 1))
; ... buy exactly 100 animals.
(assert (= (+ Dog Cat Mouse) 100))
; Spend exactly 100 dollars ...
; Dogs cost 15 dollars, cats cost 1 dollar, and
; mice cost 25 cents each.
(assert (= (+ (* 1500 Dog) (* 100 Cat) (* 25 Mouse)) 10000))

(check-sat)
(get-model)